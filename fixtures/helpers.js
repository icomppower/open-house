import { createMockCallers, loadSamplePhotos, loadText } from './mock.js';

export { createMockCallers };

let photosPromise = null;
export function samplePhotos() {
  photosPromise ||= loadSamplePhotos();
  return photosPromise;
}

export async function fixture(name) {
  return JSON.parse(await loadText(`./mock/${name}.json`));
}

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A stand-in for the viewer's captureStops(): one tiny PNG per layout camera.
export const fakeCaptureStops = async ({ state }) => state.outputs.layout.cameras.map((c) => ({ photoId: c.photoId, image: PNG_1x1 }));

export const clone = (v) => JSON.parse(JSON.stringify(v));
