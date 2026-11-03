export async function extractPDFText(file) {
  // Placeholder/Interface for pdf.js text extraction in browser
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target.result);
    };
    reader.readAsDataURL(file);
  });
}