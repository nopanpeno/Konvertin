# Mesin upscaler (disalin dari npm, tanpa CDN)

| File | Asal | Versi | Lisensi |
|---|---|---|---|
| `tf.min.js` | `@tensorflow/tfjs` (dist/tf.min.js) | 4.11.0 | Apache-2.0 |
| `upscaler.min.js` | `upscaler` (dist/browser/umd) | 1.0.0 | MIT |
| `x2/`, `x4/` | `@upscalerjs/esrgan-slim` (models/x2, x4) | 1.0.0 | MIT |

Versi tfjs 4.11.0 dipilih karena `upscaler` 1.0.0 meminta peer dependency `@tensorflow/tfjs ~4.11.0`.
Model `esrgan-slim` ringan (sekitar 0,9 MB per skala), cocok untuk dipakai di browser, tetapi hasilnya lebih halus daripada model besar seperti Real-ESRGAN.
Teks lisensi ada di file `LICENSE-*.txt` di folder ini.
