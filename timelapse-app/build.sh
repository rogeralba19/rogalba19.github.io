#!/usr/bin/env bash
# Compila el APK sin Gradle, solo con las herramientas del SDK de Android.
# Uso: ANDROID_HOME=/ruta/al/sdk ./build.sh   → genera build/timelapse.apk
set -euo pipefail

cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT=build

rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/classes" "$OUT/dex"

"$BT/aapt2" compile --dir res -o "$OUT/res/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml \
    --java "$OUT/gen" -o "$OUT/unsigned.apk" "$OUT/res/res.zip"

javac --release 8 -g -nowarn -classpath "$JAR" -d "$OUT/classes" \
    $(find src "$OUT/gen" -name '*.java')

"$BT/d8" --min-api 24 --lib "$JAR" --output "$OUT/dex" \
    $(find "$OUT/classes" -name '*.class')

cp "$OUT/unsigned.apk" "$OUT/with-dex.apk"
(cd "$OUT/dex" && zip -q ../with-dex.apk classes.dex)
"$BT/zipalign" -f 4 "$OUT/with-dex.apk" "$OUT/aligned.apk"

KEY="${KEYSTORE:-debug.keystore}"
if [ ! -f "$KEY" ]; then
    keytool -genkeypair -keystore "$KEY" -storepass android -keypass android \
        -alias debug -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Timelapse Debug" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android \
    --out "$OUT/timelapse.apk" "$OUT/aligned.apk"

echo "APK listo: $(pwd)/$OUT/timelapse.apk"
