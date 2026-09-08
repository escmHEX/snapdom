export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

// Keep PNG encoding out of the synchronous DOM work. The caller owns the
// canvas until this promise settles, including the asynchronous codec callback.
export async function canvasToDataURL(canvas, type = 'image/png', quality) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(value => {
      if (value) resolve(value)
      else reject(new Error('Canvas encoding failed'))
    }, type, quality)
  })
  return blobToDataURL(blob)
}
