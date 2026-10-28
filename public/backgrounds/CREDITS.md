# Camera background images

Used by lib/videoBackground.ts. Each scene is 1280×720, with a 320×180 copy in `thumbs/`.

| File | Source |
| --- | --- |
| shelf, studio, doorway, forest, mountains, seaside | jitsi-meet `images/virtual-background/background-2, 4, 3, 6, 5, 1` (Apache License 2.0), resized |
| indigo, mist | Gradients drawn for KloudMeet |

The segmentation model in `public/mediapipe/selfie_segmenter.tflite` is Google's MediaPipe selfie
segmenter (float16, version 1; Apache License 2.0), from
`storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/`.
