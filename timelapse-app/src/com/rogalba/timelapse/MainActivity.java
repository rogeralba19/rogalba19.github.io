package com.rogalba.timelapse;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
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
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.util.Size;
import android.view.Gravity;
import android.view.OrientationEventListener;
import android.view.Surface;
import android.view.TextureView;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Pantalla principal: vista previa para encuadrar y configuración. La
 * captura la hace {@link CaptureService}, que sigue en segundo plano y con
 * la pantalla apagada.
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMS = 1;

    private TextureView preview;
    private FrameLayout previewBox;
    private TextView previewNote;
    private EditText intervalInput;
    private EditText maxShotsInput;
    private CheckBox focusInfinity;
    private Button startButton;
    private TextView status;

    private HandlerThread camThread;
    private Handler camHandler;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private CameraDevice camera;
    private CameraCaptureSession session;
    private CameraCharacteristics chars;
    private Size previewSize;
    private Surface previewSurface;
    private int sensorOrientation = 90;

    private OrientationEventListener orientationListener;
    private int deviceDegrees = 0;
    private boolean resumed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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

        previewNote = new TextView(this);
        previewNote.setText("Capturando en segundo plano.\nPuedes apagar la pantalla.");
        previewNote.setTextColor(Color.parseColor("#FFC56B"));
        previewNote.setTextSize(16);
        previewNote.setGravity(Gravity.CENTER);
        previewNote.setVisibility(TextView.GONE);
        previewBox.addView(previewNote, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));

        intervalInput = addField(root, "Intervalo entre fotos (segundos)", "5");
        maxShotsInput = addField(root, "Número de fotos (0 = sin límite)", "0");
        focusInfinity = addCheck(root, "Enfoque fijo al infinito (recomendado para paisajes)", true);

        startButton = new Button(this);
        startButton.setText("Iniciar");
        startButton.setTextSize(18);
        startButton.setOnClickListener(v -> {
            if (CaptureService.running) stopTimelapse(); else startTimelapse();
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

    private void setStatus(String s) {
        ui.post(() -> status.setText(s));
    }

    /** Refresca la pantalla con el estado del servicio, una vez por segundo. */
    private final Runnable refresh = new Runnable() {
        private boolean wasRunning = false;

        @Override public void run() {
            boolean running = CaptureService.running;
            intervalInput.setEnabled(!running);
            maxShotsInput.setEnabled(!running);
            focusInfinity.setEnabled(!running);
            startButton.setText(running ? "Detener" : "Iniciar");
            previewNote.setVisibility(running ? TextView.VISIBLE : TextView.GONE);
            preview.setVisibility(running ? TextView.INVISIBLE : TextView.VISIBLE);

            if (running) {
                long elapsed = Math.max(0,
                        (System.currentTimeMillis() - CaptureService.startWallClock) / 1000);
                int max = CaptureService.maxShotsShown;
                String s = "Capturando… " + CaptureService.shotsSaved + " fotos"
                        + (max > 0 ? " de " + max : "")
                        + "\nTiempo: " + String.format(Locale.US, "%02d:%02d:%02d",
                        elapsed / 3600, (elapsed / 60) % 60, elapsed % 60)
                        + "\nCarpeta: " + CaptureService.folder
                        + "\nDeja el teléfono conectado al cargador.";
                if (CaptureService.lastError != null) s += "\n⚠ " + CaptureService.lastError;
                status.setText(s);
            } else if (wasRunning) {
                String s = "Terminado. " + CaptureService.shotsSaved + " fotos en "
                        + CaptureService.folder;
                if (CaptureService.lastError != null) s += "\n⚠ " + CaptureService.lastError;
                status.setText(s);
                // Espera a que el servicio suelte la cámara.
                ui.postDelayed(MainActivity.this::openPreviewIfPossible, 1500);
            }
            wasRunning = running;
            if (resumed) ui.postDelayed(this, 1000);
        }
    };

    // --------------------------------------------------------- Lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (orientationListener.canDetectOrientation()) orientationListener.enable();
        camThread = new HandlerThread("preview");
        camThread.start();
        camHandler = new Handler(camThread.getLooper());
        if (hasPermissions()) {
            openPreviewIfPossible();
        } else {
            requestPermissions(neededPermissions(), REQ_PERMS);
        }
        ui.post(refresh);
    }

    @Override
    protected void onPause() {
        resumed = false;
        ui.removeCallbacks(refresh);
        orientationListener.disable();
        closePreview();
        camThread.quitSafely();
        camThread = null;
        camHandler = null;
        super.onPause();
    }

    private String[] neededPermissions() {
        List<String> p = new ArrayList<>();
        p.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT < 29) p.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        if (Build.VERSION.SDK_INT >= 33) p.add(Manifest.permission.POST_NOTIFICATIONS);
        return p.toArray(new String[0]);
    }

    private boolean hasPermissions() {
        for (String p : neededPermissions()) {
            if (Manifest.permission.POST_NOTIFICATIONS.equals(p)) continue; // opcional
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_PERMS) return;
        if (hasPermissions()) {
            openPreviewIfPossible();
        } else {
            status.setText("Se necesita permiso de cámara (y almacenamiento en Android antiguo).");
        }
    }

    /** Pide no restringir la batería, para que el sistema no detenga la captura. */
    @SuppressLint("BatteryLife")
    private void askIgnoreBatteryOptimizations() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) { }
    }

    // ----------------------------------------------------------- Preview

    private void openPreviewIfPossible() {
        if (!resumed || CaptureService.running || !hasPermissions()) return;
        if (preview.isAvailable()) {
            openCamera();
            return;
        }
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
                if (!CaptureService.running) openCamera();
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {}
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { return true; }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture st) {}
        });
    }

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
            Size jpeg = java.util.Collections.max(
                    Arrays.asList(map.getOutputSizes(android.graphics.ImageFormat.JPEG)),
                    java.util.Comparator.comparingLong(s -> (long) s.getWidth() * s.getHeight()));
            previewSize = choosePreviewSize(map.getOutputSizes(SurfaceTexture.class), jpeg);
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
            previewSurface = new Surface(st);
            camera.createCaptureSession(Arrays.asList(previewSurface),
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession s) {
                            session = s;
                            startPreview();
                        }
                        @Override public void onConfigureFailed(CameraCaptureSession s) {
                            setStatus("No se pudo configurar la cámara.");
                        }
                    }, camHandler);
        } catch (CameraAccessException | IllegalStateException e) {
            setStatus("Error de cámara: " + e.getMessage());
        }
    }

    private void startPreview() {
        try {
            CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            b.addTarget(previewSurface);
            CaptureService.applyCommonSettings(b, chars, focusInfinity.isChecked());
            session.setRepeatingRequest(b.build(), null, camHandler);
            if (!CaptureService.running) {
                setStatus("Listo. Coloca el teléfono fijo, encuadra y pulsa Iniciar.");
            }
        } catch (CameraAccessException | IllegalStateException e) {
            setStatus("Error de vista previa: " + e.getMessage());
        }
    }

    private void closePreview() {
        try {
            if (session != null) session.close();
        } catch (Exception ignored) { }
        session = null;
        if (camera != null) camera.close();
        camera = null;
    }

    // ---------------------------------------------------------- Timelapse

    private void startTimelapse() {
        if (!hasPermissions()) {
            requestPermissions(neededPermissions(), REQ_PERMS);
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

        // La cámara la usa el servicio: suelta la vista previa primero.
        closePreview();

        Intent i = new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_INTERVAL_MS, Math.round(secs * 1000))
                .putExtra(CaptureService.EXTRA_MAX_SHOTS, Math.max(0, max))
                .putExtra(CaptureService.EXTRA_FOCUS_INFINITY, focusInfinity.isChecked())
                // Fija la orientación al iniciar para que todas las fotos salgan iguales.
                .putExtra(CaptureService.EXTRA_JPEG_ORIENTATION,
                        (sensorOrientation + deviceDegrees) % 360);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);

        askIgnoreBatteryOptimizations();
    }

    private void stopTimelapse() {
        startService(new Intent(this, CaptureService.class).setAction(CaptureService.ACTION_STOP));
    }
}
