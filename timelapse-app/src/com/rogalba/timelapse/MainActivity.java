package com.rogalba.timelapse;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.Spinner;
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
    private boolean frontFacing = false;

    private Spinner cameraSpinner;
    private Spinner sizeSpinner;
    private final List<String> cameraIds = new ArrayList<>();
    private final List<Size> jpegSizes = new ArrayList<>();
    private String currentCameraId;
    private Size selectedSize;
    private SharedPreferences prefs;

    private OrientationEventListener orientationListener;
    private int deviceDegrees = 0;
    private boolean resumed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("ajustes", MODE_PRIVATE);
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
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.3f);
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

        // Ajustes en una zona desplazable para que quepan en pantallas pequeñas.
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(form);
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        cameraSpinner = addSpinner(form, "Cámara");
        cameraSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, android.view.View v, int pos, long id) {
                onCameraChosen(pos);
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        sizeSpinner = addSpinner(form, "Tamaño de foto");
        sizeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, android.view.View v, int pos, long id) {
                onSizeChosen(pos);
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });

        intervalInput = addField(form, "Intervalo entre fotos (segundos)", "5");
        maxShotsInput = addField(form, "Número de fotos (0 = sin límite)", "0");
        focusInfinity = addCheck(form, "Enfoque fijo al infinito (recomendado para paisajes)", true);

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

    private Spinner addSpinner(LinearLayout root, String label) {
        TextView l = new TextView(this);
        l.setText(label);
        l.setTextColor(Color.parseColor("#AAAAAA"));
        l.setTextSize(13);
        root.addView(l);
        Spinner s = new Spinner(this);
        root.addView(s);
        return s;
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
            cameraSpinner.setEnabled(!running);
            sizeSpinner.setEnabled(!running);
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
            if (cameraIds.isEmpty()) loadCameras(mgr);
            String id = currentCameraId;
            chars = mgr.getCameraCharacteristics(id);
            Integer so = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 90 : so;
            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
            frontFacing = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;

            StreamConfigurationMap map =
                    chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            previewSize = choosePreviewSize(map.getOutputSizes(SurfaceTexture.class), selectedSize);
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

    /** Llena el selector de cámaras (una vez) y elige la guardada o la trasera. */
    private void loadCameras(CameraManager mgr) throws CameraAccessException {
        List<String> labels = new ArrayList<>();
        String saved = prefs.getString("camera", null);
        String firstBack = null;
        int backN = 0, frontN = 0, otherN = 0;
        for (String id : mgr.getCameraIdList()) {
            CameraCharacteristics c = mgr.getCameraCharacteristics(id);
            Integer facing = c.get(CameraCharacteristics.LENS_FACING);
            String label;
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                label = "Trasera " + (++backN);
                if (firstBack == null) firstBack = id;
            } else if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                label = "Frontal " + (++frontN);
            } else {
                label = "Externa " + (++otherN);
            }
            float[] focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
            if (focal != null && focal.length > 0) {
                label += String.format(Locale.US, " · %.1f mm", focal[0]);
            }
            cameraIds.add(id);
            labels.add(label);
        }
        if (cameraIds.contains(saved)) currentCameraId = saved;
        else if (firstBack != null) currentCameraId = firstBack;
        else currentCameraId = cameraIds.get(0);

        cameraSpinner.setAdapter(spinnerAdapter(labels));
        cameraSpinner.setSelection(cameraIds.indexOf(currentCameraId), false);
        loadSizes(mgr);
    }

    /** Llena el selector de tamaños de foto para la cámara actual, de mayor a menor. */
    private void loadSizes(CameraManager mgr) throws CameraAccessException {
        StreamConfigurationMap map = mgr.getCameraCharacteristics(currentCameraId)
                .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        jpegSizes.clear();
        jpegSizes.addAll(Arrays.asList(map.getOutputSizes(android.graphics.ImageFormat.JPEG)));
        jpegSizes.sort((a, b) -> Long.compare(
                (long) b.getWidth() * b.getHeight(), (long) a.getWidth() * a.getHeight()));

        List<String> labels = new ArrayList<>();
        for (Size s : jpegSizes) {
            double mp = s.getWidth() * (double) s.getHeight() / 1e6;
            labels.add(String.format(Locale.US, "%d×%d · %.1f MP · %s",
                    s.getWidth(), s.getHeight(), mp, aspectLabel(s)));
        }
        String saved = prefs.getString("size_" + currentCameraId, null);
        selectedSize = jpegSizes.get(0);
        for (Size s : jpegSizes) if (s.toString().equals(saved)) selectedSize = s;

        sizeSpinner.setAdapter(spinnerAdapter(labels));
        sizeSpinner.setSelection(jpegSizes.indexOf(selectedSize), false);
    }

    private static String aspectLabel(Size s) {
        double r = (double) Math.max(s.getWidth(), s.getHeight())
                / Math.min(s.getWidth(), s.getHeight());
        if (Math.abs(r - 4.0 / 3) < 0.02) return "4:3";
        if (Math.abs(r - 16.0 / 9) < 0.02) return "16:9";
        if (Math.abs(r - 1) < 0.02) return "1:1";
        if (Math.abs(r - 3.0 / 2) < 0.02) return "3:2";
        return String.format(Locale.US, "%.2f:1", r);
    }

    private ArrayAdapter<String> spinnerAdapter(List<String> items) {
        ArrayAdapter<String> a = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, items);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return a;
    }

    private void onCameraChosen(int pos) {
        if (pos < 0 || pos >= cameraIds.size()) return;
        String id = cameraIds.get(pos);
        if (id.equals(currentCameraId)) return;
        currentCameraId = id;
        prefs.edit().putString("camera", id).apply();
        try {
            loadSizes((CameraManager) getSystemService(Context.CAMERA_SERVICE));
        } catch (CameraAccessException e) {
            setStatus("Error de cámara: " + e.getMessage());
        }
        restartPreview();
    }

    private void onSizeChosen(int pos) {
        if (pos < 0 || pos >= jpegSizes.size()) return;
        Size s = jpegSizes.get(pos);
        if (s.equals(selectedSize)) return;
        selectedSize = s;
        prefs.edit().putString("size_" + currentCameraId, s.toString()).apply();
        restartPreview();
    }

    private void restartPreview() {
        if (CaptureService.running) return;
        closePreview();
        openPreviewIfPossible();
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
        if (currentCameraId == null || selectedSize == null) {
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

        // La cámara la usa el servicio: suelta la vista previa primero.
        closePreview();

        Intent i = new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_INTERVAL_MS, Math.round(secs * 1000))
                .putExtra(CaptureService.EXTRA_MAX_SHOTS, Math.max(0, max))
                .putExtra(CaptureService.EXTRA_FOCUS_INFINITY, focusInfinity.isChecked())
                // Fija la orientación al iniciar para que todas las fotos salgan iguales.
                .putExtra(CaptureService.EXTRA_JPEG_ORIENTATION, frontFacing
                        ? (sensorOrientation - deviceDegrees + 360) % 360
                        : (sensorOrientation + deviceDegrees) % 360)
                .putExtra(CaptureService.EXTRA_CAMERA_ID, currentCameraId)
                .putExtra(CaptureService.EXTRA_WIDTH, selectedSize.getWidth())
                .putExtra(CaptureService.EXTRA_HEIGHT, selectedSize.getHeight());
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);

        askIgnoreBatteryOptimizations();
    }

    private void stopTimelapse() {
        startService(new Intent(this, CaptureService.class).setAction(CaptureService.ACTION_STOP));
    }
}
