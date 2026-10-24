package com.rogalba.timelapse;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
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
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Size;
import android.view.Gravity;
import android.view.OrientationEventListener;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

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
 * Cámara de intervalos para timelapse. Captura una foto cada N segundos
 * y la guarda en Imágenes/Timelapse/<sesión>. El flash y la linterna
 * nunca se activan: todas las peticiones usan AE_MODE_ON + FLASH_MODE_OFF
 * y la app jamás llama a setTorchMode.
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMS = 1;

    private TextureView preview;
    private FrameLayout previewBox;
    private EditText intervalInput;
    private EditText maxShotsInput;
    private CheckBox focusInfinity;
    private CheckBox dimScreen;
    private Button startButton;
    private TextView status;

    private HandlerThread camThread;
    private Handler camHandler;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private CameraCharacteristics chars;
    private Size previewSize;
    private int sensorOrientation;

    private OrientationEventListener orientationListener;
    private int deviceDegrees = 0;

    private boolean running = false;
    private long startUptime;
    private long intervalMs;
    private int maxShots;
    private int shotsRequested;
    private volatile int shotsSaved;
    private String sessionName;
    private int lockedJpegOrientation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildUi();

        orientationListener = new OrientationEventListener(this) {
            @Override
            public void onOrientationChanged(int orientation) {
                if (orientation == ORIENTATION_UNKNOWN) return;
                deviceDegrees = ((orientation + 45) / 90 * 90) % 360;
            }
        };
    }

    // ---------------------------------------------------------------- UI

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#14101C"));
        root.setPadding(dp(16), dp(24), dp(16), dp(16));

        TextView title = new TextView(this);
        title.setText("Timelapse · sin flash");
        title.setTextColor(Color.parseColor("#FFC56B"));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        previewBox = new FrameLayout(this);
        previewBox.setBackgroundColor(Color.BLACK);
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        boxLp.topMargin = dp(12);
        boxLp.bottomMargin = dp(12);
        root.addView(previewBox, boxLp);

        preview = new TextureView(this);
        previewBox.addView(preview, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));

        intervalInput = addField(root, "Intervalo entre fotos (segundos)", "5");
        maxShotsInput = addField(root, "Número de fotos (0 = sin límite)", "0");

        focusInfinity = addCheck(root, "Enfoque fijo al infinito (recomendado para paisajes)", true);
        dimScreen = addCheck(root, "Bajar el brillo de la pantalla mientras captura", true);

        startButton = new Button(this);
        startButton.setText("Iniciar");
        startButton.setTextSize(18);
        startButton.setOnClickListener(v -> {
            if (running) stopTimelapse(); else startTimelapse();
        });
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        btnLp.topMargin = dp(8);
        root.addView(startButton, btnLp);

        status = new TextView(this);
        status.setTextColor(Color.parseColor("#DDDDDD"));
        status.setTextSize(14);
        status.setPadding(0, dp(8), 0, 0);
        status.setText("Listo.");
        root.addView(status);

        setContentView(root);
    }

    private EditText addField(LinearLayout root, String label, String def) {
        TextView l = new TextView(this);
        l.setText(label);
        l.setTextColor(Color.parseColor("#AAAAAA"));
        l.setTextSize(13);
        root.addView(l);
        EditText e = new EditText(this);
        e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        e.setText(def);
        e.setTextColor(Color.WHITE);
        e.setSingleLine(true);
        root.addView(e);
        return e;
    }

    private CheckBox addCheck(LinearLayout root, String label, boolean checked) {
        CheckBox c = new CheckBox(this);
        c.setText(label);
        c.setTextColor(Color.parseColor("#DDDDDD"));
        c.setChecked(checked);
        root.addView(c);
        return c;
    }

    private void setControlsEnabled(boolean enabled) {
        intervalInput.setEnabled(enabled);
        maxShotsInput.setEnabled(enabled);
        focusInfinity.setEnabled(enabled);
        dimScreen.setEnabled(enabled);
    }

    private void setStatus(String s) {
        ui.post(() -> status.setText(s));
    }

    // --------------------------------------------------------- Lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        if (orientationListener.canDetectOrientation()) orientationListener.enable();
        camThread = new HandlerThread("camera");
        camThread.start();
        camHandler = new Handler(camThread.getLooper());
        if (hasPermissions()) {
            whenPreviewReady();
        } else {
            requestPermissions(neededPermissions(), REQ_PERMS);
        }
    }

    @Override
    protected void onPause() {
        if (running) {
            stopTimelapse();
            Toast.makeText(this, "Captura detenida: la app debe quedar abierta.",
                    Toast.LENGTH_LONG).show();
        }
        orientationListener.disable();
        closeCamera();
        camThread.quitSafely();
        camThread = null;
        camHandler = null;
        super.onPause();
    }

    private String[] neededPermissions() {
        if (Build.VERSION.SDK_INT < 29) {
            return new String[]{Manifest.permission.CAMERA,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE};
        }
        return new String[]{Manifest.permission.CAMERA};
    }

    private boolean hasPermissions() {
        for (String p : neededPermissions()) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_PERMS) return;
        if (hasPermissions()) {
            whenPreviewReady();
        } else {
            status.setText("Se necesita permiso de cámara (y almacenamiento en Android antiguo).");
        }
    }

    private void whenPreviewReady() {
        if (preview.isAvailable()) {
            openCamera();
            return;
        }
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
                openCamera();
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {}
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { return true; }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture st) {}
        });
    }

    // ------------------------------------------------------------ Camera

    private void openCamera() {
        if (camera != null || camHandler == null) return;
        CameraManager mgr = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        try {
            String id = null;
            for (String c : mgr.getCameraIdList()) {
                Integer facing = mgr.getCameraCharacteristics(c)
                        .get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    id = c;
                    break;
                }
            }
            if (id == null) id = mgr.getCameraIdList()[0];
            chars = mgr.getCameraCharacteristics(id);
            Integer so = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 90 : so;

            StreamConfigurationMap map =
                    chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size jpeg = Collections.max(Arrays.asList(map.getOutputSizes(android.graphics.ImageFormat.JPEG)),
                    Comparator.comparingLong(s -> (long) s.getWidth() * s.getHeight()));
            previewSize = choosePreviewSize(map.getOutputSizes(SurfaceTexture.class), jpeg);

            reader = ImageReader.newInstance(jpeg.getWidth(), jpeg.getHeight(),
                    android.graphics.ImageFormat.JPEG, 4);
            reader.setOnImageAvailableListener(this::saveImage, camHandler);

            ui.post(this::fitPreview);

            mgr.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice d) {
                    camera = d;
                    createSession();
                }
                @Override public void onDisconnected(CameraDevice d) {
                    d.close();
                    camera = null;
                }
                @Override public void onError(CameraDevice d, int error) {
                    d.close();
                    camera = null;
                    setStatus("Error al abrir la cámara (" + error + ").");
                }
            }, camHandler);
        } catch (CameraAccessException | SecurityException e) {
            setStatus("No se pudo abrir la cámara: " + e.getMessage());
        }
    }

    /** Elige un tamaño de vista previa con la misma proporción que la foto, ≤ 1920 px. */
    private Size choosePreviewSize(Size[] options, Size jpeg) {
        double target = (double) jpeg.getWidth() / jpeg.getHeight();
        Size best = null;
        for (Size s : options) {
            if (s.getWidth() > 1920 || s.getHeight() > 1440) continue;
            double r = (double) s.getWidth() / s.getHeight();
            if (Math.abs(r - target) > 0.02) continue;
            if (best == null || s.getWidth() * s.getHeight() > best.getWidth() * best.getHeight()) {
                best = s;
            }
        }
        return best != null ? best : options[0];
    }

    /** Ajusta el TextureView a la proporción de la cámara (la app va en vertical). */
    private void fitPreview() {
        int boxW = previewBox.getWidth();
        int boxH = previewBox.getHeight();
        if (boxW == 0 || boxH == 0) {
            previewBox.post(this::fitPreview);
            return;
        }
        boolean swap = sensorOrientation == 90 || sensorOrientation == 270;
        double ratio = swap
                ? (double) previewSize.getHeight() / previewSize.getWidth()
                : (double) previewSize.getWidth() / previewSize.getHeight();
        int w = boxW;
        int h = (int) Math.round(w / ratio);
        if (h > boxH) {
            h = boxH;
            w = (int) Math.round(h * ratio);
        }
        preview.setLayoutParams(new FrameLayout.LayoutParams(w, h, Gravity.CENTER));
    }

    private void createSession() {
        try {
            SurfaceTexture st = preview.getSurfaceTexture();
            if (st == null || camera == null) return;
            st.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            Surface previewSurface = new Surface(st);
            camera.createCaptureSession(Arrays.asList(previewSurface, reader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession s) {
                            session = s;
                            startPreview(previewSurface);
                        }
                        @Override public void onConfigureFailed(CameraCaptureSession s) {
                            setStatus("No se pudo configurar la cámara.");
                        }
                    }, camHandler);
        } catch (CameraAccessException e) {
            setStatus("Error de cámara: " + e.getMessage());
        }
    }

    private Surface previewSurfaceRef;

    private void startPreview(Surface previewSurface) {
        previewSurfaceRef = previewSurface;
        try {
            CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            b.addTarget(previewSurface);
            applyCommonSettings(b);
            session.setRepeatingRequest(b.build(), null, camHandler);
            if (!running) setStatus("Listo. Coloca el teléfono fijo y pulsa Iniciar.");
        } catch (CameraAccessException | IllegalStateException e) {
            setStatus("Error de vista previa: " + e.getMessage());
        }
    }

    /** Ajustes compartidos: exposición automática SIN flash y enfoque. */
    private void applyCommonSettings(CaptureRequest.Builder b) {
        b.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        // AE_MODE_ON = exposición automática que nunca dispara el flash.
        b.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        b.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF);
        b.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);

        Float minFocus = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
        if (focusInfinity.isChecked() && minFocus != null && minFocus > 0f) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF);
            b.set(CaptureRequest.LENS_FOCUS_DISTANCE, 0f); // 0 = infinito
        } else if (minFocus != null && minFocus > 0f) {
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        }
    }

    private void closeCamera() {
        try {
            if (session != null) session.close();
        } catch (Exception ignored) { }
        session = null;
        if (camera != null) camera.close();
        camera = null;
        if (reader != null) reader.close();
        reader = null;
    }

    // ---------------------------------------------------------- Timelapse

    private void startTimelapse() {
        if (session == null) {
            Toast.makeText(this, "La cámara aún no está lista.", Toast.LENGTH_SHORT).show();
            return;
        }
        double secs;
        try {
            secs = Double.parseDouble(intervalInput.getText().toString().replace(',', '.'));
        } catch (NumberFormatException e) {
            secs = 0;
        }
        if (secs < 1) {
            Toast.makeText(this, "El intervalo mínimo es 1 segundo.", Toast.LENGTH_SHORT).show();
            return;
        }
        int max;
        try {
            max = (int) Double.parseDouble(maxShotsInput.getText().toString());
        } catch (NumberFormatException e) {
            max = 0;
        }

        intervalMs = Math.round(secs * 1000);
        maxShots = Math.max(0, max);
        shotsRequested = 0;
        shotsSaved = 0;
        sessionName = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        // Fija la orientación al iniciar para que todas las fotos salgan iguales.
        lockedJpegOrientation = (sensorOrientation + deviceDegrees) % 360;

        // Reaplica el enfoque elegido a la vista previa.
        if (previewSurfaceRef != null) startPreview(previewSurfaceRef);

        running = true;
        setControlsEnabled(false);
        startButton.setText("Detener");
        if (dimScreen.isChecked()) setBrightness(0.02f);

        startUptime = SystemClock.uptimeMillis() + 1000; // 1 s para que no vibre al tocar
        ui.postAtTime(tick, startUptime);
        updateStatus();
    }

    private void stopTimelapse() {
        running = false;
        ui.removeCallbacks(tick);
        setControlsEnabled(true);
        startButton.setText("Iniciar");
        setBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
        status.setText("Detenido. " + shotsSaved + " fotos guardadas en Imágenes/Timelapse/"
                + sessionName);
    }

    private void setBrightness(float value) {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = value;
        getWindow().setAttributes(lp);
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            takePicture();
            shotsRequested++;
            if (maxShots > 0 && shotsRequested >= maxShots) {
                ui.postDelayed(() -> { if (running) stopTimelapse(); }, 1500);
                return;
            }
            // Programación basada en la hora de inicio para no acumular retraso.
            ui.postAtTime(this, startUptime + shotsRequested * intervalMs);
        }
    };

    private void takePicture() {
        if (camera == null || session == null) return;
        try {
            CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            b.addTarget(reader.getSurface());
            applyCommonSettings(b);
            b.set(CaptureRequest.JPEG_ORIENTATION, lockedJpegOrientation);
            b.set(CaptureRequest.JPEG_QUALITY, (byte) 95);
            session.capture(b.build(), null, camHandler);
        } catch (CameraAccessException | IllegalStateException e) {
            setStatus("Error al capturar: " + e.getMessage());
        }
    }

    private void updateStatus() {
        if (!running) return;
        long elapsed = (SystemClock.uptimeMillis() - startUptime) / 1000;
        if (elapsed < 0) elapsed = 0;
        String s = "Capturando… " + shotsSaved + " fotos"
                + (maxShots > 0 ? " de " + maxShots : "")
                + "\nTiempo: " + String.format(Locale.US, "%02d:%02d:%02d",
                elapsed / 3600, (elapsed / 60) % 60, elapsed % 60)
                + "\nCarpeta: Imágenes/Timelapse/" + sessionName
                + "\nMantén la app abierta y el teléfono conectado al cargador.";
        status.setText(s);
        ui.postDelayed(this::updateStatus, 1000);
    }

    // ------------------------------------------------------------ Saving

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
        } catch (Exception e) {
            setStatus("Error al guardar la foto: " + e.getMessage());
        }
    }
}
