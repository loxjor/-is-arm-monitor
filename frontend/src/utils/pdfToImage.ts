// Предел длинной стороны растра: крупный архитектурный лист всё равно не
// нужен в полном разрешении, а мелкий (А4) рендерится вдвое крупнее.
const MAX_SIDE_PX = 4000;
const BASE_SCALE = 2;

/**
 * Рендерит первую страницу PDF в PNG (data URL) — подложку плана. Белый фон
 * подкладывается заранее: у векторного PDF без фона страница осталась бы
 * прозрачной и потерялась бы на тёмной теме редактора. pdf.js подключается
 * лениво, чтобы не раздувать основной бандл: он нужен только при загрузке PDF.
 */
export async function renderPdfToImage(file: File): Promise<string> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const longestSide = Math.max(base.width, base.height);
    const scale = Math.min(BASE_SCALE, MAX_SIDE_PX / longestSide);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('не удалось создать холст для рендера PDF');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    void pdf.destroy();
  }
}
