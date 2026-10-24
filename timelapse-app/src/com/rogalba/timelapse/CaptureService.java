package com.rogalba.timelapse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Size;
import android.view.Surface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;

/**
 * Servicio en primer plano que hace el timelapse. Sigue funcionando con la
 * app en segundo plano y con la pantalla apagada (mantiene un wake lock
 * parcial). El flash y la linterna nunca se activan: todas las peticiones
 * usan AE_MODE_ON + FLASH_MODE_OFF y nunca se llama a setTorchMode.
 */
public class CaptureService extends Service {

    static final String ACTION_START = "com.rogalba.timelapse.START";
    static final String ACTION_STOP = "com.rogalba.timelapse.STOP";
    static final String EXTRA_INTERVAL_MS = "interval_ms";
    static final String EXTRA_MAX_SHOTS = "max_shots";
    static final String EXTRA_FOCUS_INFINITY = "focus_infinity";
    static final String EXTRA_JPEG_ORIENTATION = "jpeg_orientation";
    static final String EXTRA_CAMERA_ID = "camera_id";
    static final String EXTRA_WIDTH = "width";
    static final String EXTRA_HEIGHT = "height";

    private static final String CHANNEL = "timelapse";
    private static final int NOTIF_ID = 1;

    // Estado que lee la pantalla principal.
    static volatile boolean running = false;
    static volatile int shotsSaved = 0;
    static volatile int maxShotsShown = 0;
    static volatile long startWallClock = 0;
    static volatile String folder = "";
    static volatile String lastError = null;

    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock wakeLock;

    private CameraDevice camera;
    private CameraCaptureSession session;
    private CameraCharacteristics chars;
    private ImageReader jpegReader;
    private ImageReader meterReader;

    private long intervalMs;
    private int maxShots;
    private boolean focusInfinity;
    private int jpegOrientation;
    private String cameraId;
    private int photoWidth;
    private int photoHeight;
    private String sessionName;
    private long startUptime;
    private int shotsRequested;
    private int openAttempts;
    private boolean stopping;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopAll();
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;

        intervalMs = intent.getLongExtra(EXTRA_INTERVAL_MS, 5000);
        maxShots = intent.getIntExtra(EXTRA_MAX_SHOTS, 0);
        focusInfinity = intent.getBooleanExtra(EXTRA_FOCUS_INFINITY, true);
        jpegOrientation = intent.getIntExtra(EXTRA_JPEG_ORIENTATION, 90);
        cameraId = intent.getStringExtra(EXTRA_CAMERA_ID);
        photoWidth = intent.getIntExtra(EXTRA_WIDTH, 0);
        photoHeight = intent.getIntExtra(EXTRA_HEIGHT, 0);
        sessionName = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());

        running = true;
        stopping = false;
        shotsSaved = 0;
        shotsRequested = 0;
        maxShotsShown = maxShots;
        startWallClock = System.currentTimeMillis();
        folder = "Imágenes/Timelapse/" + sessionName;
        lastError = null;

        createChannel();
        Notification n = buildNotification("Iniciando…");
        if (Build.VERSION.SDK_INT >= 30) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);
        } else {
            startForeground(NOTIF_ID, n);
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "timelapse:capture");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();

        thread = new HandlerThread("capture");
        thread.start();
        handler = new Handler(thread.getLooper());
        openAttempts = 0;
        handler.post(this::openCamera);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopAll();
        super.onDestroy();
    }

    // ------------------------------------------------------- Notification

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Timelapse",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Captura de timelapse en curso");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification(String text) {
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), piFlags);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, CaptureService.class).setAction(ACTION_STOP), piFlags);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("Timelapse en curso")
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(0, "Detener", stop).build());
        return b.build();
    }

    private void updateNotification() {
        if (!running) return;
        String text = shotsSaved + (maxShots > 0 ? " / " + maxShots : "") + " fotos · " + folder;
        getSystemService(NotificationManager.class).notify(NOTIF_ID, buildNotification(text));
    }

    // ------------------------------------------------------------ Camera

    private void openCamera() {
        if (!running) return;
        CameraManager mgr = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            String id = Arrays.asList(mgr.getCameraIdList()).contains(cameraId)
                    ? cameraId : mgr.getCameraIdList()[0];
            chars = mgr.getCameraCharacteristics(id);

            StreamConfigurationMap map =
                    chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size[] jpegSizes = map.getOutputSizes(ImageFormat.JPEG);
            Size jpeg = Collections.max(Arrays.asList(jpegSizes),
                    Comparator.comparingLong(s -> (long) s.getWidth() * s.getHeight()));
            for (Size s : jpegSizes) {
                if (s.getWidth() == photoWidth && s.getHeight() == photoHeight) jpeg = s;
            }
            Size meter = smallestAtLeast(map.getOutputSizes(ImageFormat.YUV_420_888), 640);

            if (jpegReader == null) {
                jpegReader = ImageReader.newInstance(jpeg.getWidth(), jpeg.getHeight(),
                        ImageFormat.JPEG, 4);
                jpegReader.setOnImageAvailableListener(this::saveImage, handler);
                // Flujo pequeño y continuo para que la exposición automática
                // se mantenga ajustada aunque no haya vista previa en pantalla.
                meterReader = ImageReader.newInstance(meter.getWidth(), meter.getHeight(),
                        ImageFormat.YUV_420_888, 2);
                meterReader.setOnImageAvailableListener(r -> {
                    Image i = r.acquireLatestImage();
                    if (i != null) i.close();
                }, handler);
            }

            mgr.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice d) {
                    if (!running) { d.close(); return; }
                    camera = d;
                    createSession();
                }
                @Override public void onDisconnected(CameraDevice d) {
                    d.close();
                    camera = null;
                    session = null;
                    retryOpen("Otra app tomó la cámara");
                }
                @Override public void onError(CameraDevice d, int error) {
                    d.close();
                    camera = null;
                    session = null;
                    retryOpen("Error de cámara " + error);
                }
            }, handler);
        } catch (CameraAccessException | SecurityException | IllegalArgumentException e) {
            retryOpen(e.getMessage());
        }
    }

    /** Reintenta abrir la cámara (p. ej. si la vista previa aún no la había soltado). */
    private void retryOpen(String reason) {
        if (!running) return;
        openAttempts++;
        if (openAttempts > 20) {
            lastError = "No se pudo usar la cámara: " + reason;
            stopAll();
            return;
        }
        lastError = reason + " — reintentando…";
        handler.postDelayed(this::openCamera, 1000);
    }

    private static Size smallestAtLeast(Size[] sizes, int minWidth) {
        Size best = null;
        for (Size s : sizes) {
            if (s.getWidth() < minWidth) continue;
            if (best == null || s.getWidth() * s.getHeight() < best.getWidth() * best.getHeight()) {
                best = s;
            }
        }
        return best != null ? best : sizes[0];
    }

    private void createSession() {
        try {
            camera.createCaptureSession(
                    Arrays.asList(meterReader.getSurface(), jpegReader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession s) {
                            if (!running) { s.close(); return; }
                            session = s;
                            startMetering();
                        }
                        @Override public void onConfigureFailed(CameraCaptureSession s) {
                            retryOpen("No se pudo configurar la cámara");
                        }
                    }, handler);
        } catch (CameraAccessException | IllegalStateException e) {
            retryOpen(e.getMessage());
        }
    }

    private void startMetering() {
        try {
            CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            b.addTarget(meterReader.getSurface());
            applyCommonSettings(b, chars, focusInfinity);
            session.setRepeatingRequest(b.build(), null, handler);
            lastError = null;
            openAttempts = 0;
            if (startUptime == 0) {
                // Primera vez: 2 s para que la exposición se estabilice.
                startUptime = SystemClock.uptimeMillis() + 2000;
                handler.postAtTime(tick, startUptime);
            }
        } catch (CameraAccessException | IllegalStateException e) {
            retryOpen(e.getMessage());
        }
    }

    /** Ajustes compartidos: exposición automática SIN flash y enfoque. */
    static void applyCommonSettings(CaptureRequest.Builder b, CameraCharacteristics chars,
                                    boolean focusInfinity) {
        b.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        // AE_MODE_ON = exposición automática que nunca dispara el flash.
        b.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        b.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF);
        b.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);

        Float minFocus = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
        if (focusInfinity && minFocus != null && minFocus > 0f) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF);
            b.set(CaptureRequest.LENS_FOCUS_DISTANCE, 0f); // 0 = infinito
        } else if (minFocus != null && minFocus > 0f) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        }
    }

    // ---------------------------------------------------------- Timelapse

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            takePicture();
            shotsRequested++;
            if (maxShots > 0 && shotsRequested >= maxShots) {
                handler.postDelayed(CaptureService.this::stopAll, 3000);
                return;
            }
            // Programación basada en la hora de inicio para no acumular retraso.
            handler.postAtTime(this, startUptime + shotsRequested * intervalMs);
        }
    };

    private void takePicture() {
        if (camera == null || session == null) return; // reabriendo; se salta esta foto
        try {
            CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            b.addTarget(jpegReader.getSurface());
            applyCommonSettings(b, chars, focusInfinity);
            b.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation);
            b.set(CaptureRequest.JPEG_QUALITY, (byte) 95);
            session.capture(b.build(), null, handler);
        } catch (CameraAccessException | IllegalStateException e) {
            lastError = "Error al capturar: " + e.getMessage();
        }
    }

    private void saveImage(ImageReader r) {
        Image img = r.acquireNextImage();
        if (img == null) return;
        byte[] bytes;
        try {
            ByteBuffer buf = img.getPlanes()[0].getBuffer();
            bytes = new byte[buf.remaining()];
            buf.get(bytes);
        } finally {
            img.close();
        }
        int n = shotsSaved + 1;
        String name = String.format(Locale.US, "TL_%s_%05d.jpg", sessionName, n);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/Timelapse/" + sessionName);
                ContentResolver cr = getContentResolver();
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("MediaStore devolvió null");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    os.write(bytes);
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES), "Timelapse/" + sessionName);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("No se pudo crear la carpeta");
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()},
                        new String[]{"image/jpeg"}, null);
            }
            shotsSaved = n;
            updateNotification();
        } catch (Exception e) {
            lastError = "Error al guardar la foto: " + e.getMessage();
        }
    }

    // -------------------------------------------------------------- Stop

    private void stopAll() {
        if (stopping) return;
        stopping = true;
        running = false;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        try {
            if (session != null) session.close();
        } catch (Exception ignored) { }
        session = null;
        if (camera != null) camera.close();
        camera = null;
        if (jpegReader != null) jpegReader.close();
        jpegReader = null;
        if (meterReader != null) meterReader.close();
        meterReader = null;
        if (thread != null) thread.quitSafely();
        thread = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        startUptime = 0;
        stopForeground(true);
        stopSelf();
    }
}
