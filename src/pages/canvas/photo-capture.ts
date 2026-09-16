function jpegFileFromCanvas(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(
            new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }),
          );
        } else {
          reject(new Error('Could not encode the photo'));
        }
      },
      'image/jpeg',
      0.92,
    );
  });
}

function imageCanvas(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context || !width || !height) {
    throw new Error('Could not read the photo');
  }
  return [canvas, context];
}

export function captureVideoFrame(video: HTMLVideoElement): Promise<File> {
  const [canvas, context] = imageCanvas(video.videoWidth, video.videoHeight);
  context.drawImage(video, 0, 0);
  return jpegFileFromCanvas(canvas);
}

export async function prepareCapturedPhoto(file: File): Promise<File> {
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    return file;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const [canvas, context] = imageCanvas(
      image.naturalWidth,
      image.naturalHeight,
    );
    context.drawImage(image, 0, 0);
    return await jpegFileFromCanvas(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
