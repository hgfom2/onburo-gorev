// Fotoğrafı tarayıcıda JPEG'e çevirip küçültür (kasa raporu için; depo sınırı 2 MB)
export async function compressJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  for (const q of [0.8, 0.65, 0.5]) {
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', q));
    if (blob && blob.size <= 1.8 * 1024 * 1024) return blob;
  }
  throw new Error('Fotoğraf çok büyük.');
}
