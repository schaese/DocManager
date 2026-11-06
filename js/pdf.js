function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bilddatei konnte nicht geladen werden.'));
    };
    img.src = url;
  });
}

export async function optimizeImageFile(file, rotationDeg = 0, bwFilter = false) {
  const img = await loadImageFromFile(file);
  const maxEdge = 2000;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > maxEdge || height > maxEdge) {
    if (width >= height) {
      height = Math.round((height * maxEdge) / width);
      width = maxEdge;
    } else {
      width = Math.round((width * maxEdge) / height);
      height = maxEdge;
    }
  }

  const canvas = document.createElement('canvas');
  const swapDims = rotationDeg === 90 || rotationDeg === 270;
  canvas.width = swapDims ? height : width;
  canvas.height = swapDims ? width : height;

  const ctx = canvas.getContext('2d');
  if (bwFilter) {
    ctx.filter = 'grayscale(100%) contrast(145%)';
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(img, -width / 2, -height / 2, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height
  };
}

export async function buildPdfFromPages(pages) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage();
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / page.width, pageH / page.height);
    const imgW = page.width * ratio;
    const imgH = page.height * ratio;
    const x = (pageW - imgW) / 2;
    const y = (pageH - imgH) / 2;
    pdf.addImage(page.dataUrl, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
  });

  return pdf.output('blob');
}

export function fileToDataUrl(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(fileOrBlob);
  });
}
