/** Nén ảnh chụp từ điện thoại (tối đa 1280px, JPEG) để tiết kiệm dung lượng lưu trữ. */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Không nén được ảnh'))), 'image/jpeg', quality),
  )
}
