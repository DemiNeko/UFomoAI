const output = document.getElementById('log');
const summary = document.getElementById('summary');
const frame = document.getElementById('app');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function until(check, description, timeout = 45000) {
  const start = performance.now();
  while (!check()) { if (performance.now() - start > timeout) throw new Error(`Timeout: ${description}`); await wait(100); }
}
document.getElementById('run').addEventListener('click', async () => {
  const button = document.getElementById('run'); button.disabled = true;
  summary.textContent = 'Проверки выполняются…'; output.textContent = '';
  let timer, streams = [], passed = 0;
  const errors = [];
  const log = description => { passed++; output.textContent += `✓ ${description}\n`; };
  try {
    const w = frame.contentWindow, d = frame.contentDocument, $ = id => d.getElementById(id);
    await until(() => $('card-phone'), 'app startup');
    w.addEventListener('error', event => errors.push(event.message));
    w.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    assert($('train-button').disabled && $('predict-button').disabled && $('export-button').disabled, 'Initial actions must be gated');
    log('Начальное состояние: обучение и распознавание недоступны без данных');
    $('defense-open').click(); assert($('defense-dialog').open, 'Dialog failed');
    $('defense-close').click(); assert(!$('defense-dialog').open, 'Dialog did not close');
    log('Шпаргалка защиты открывается и закрывается');

    const source = w.document.createElement('canvas'); source.width = source.height = 224;
    const ctx = source.getContext('2d');
    let kind = 'phone', tick = 0, denyCamera = true;
    function paint() {
      tick++;
      ctx.fillStyle = kind === 'phone' ? '#fbe0ca' : kind === 'hand' ? '#c7eacb' : '#d8dbf6'; ctx.fillRect(0, 0, 224, 224);
      const offset = Math.sin(tick / 30) * 4;
      ctx.fillStyle = '#203b32';
      if (kind === 'phone') { ctx.fillRect(70 + offset, 22, 85, 180); ctx.fillStyle = '#779fbf'; ctx.fillRect(78 + offset, 35, 69, 145); }
      else if (kind === 'hand') { ctx.beginPath(); ctx.arc(112, 120 + offset, 65, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(94, 40, 25, 160); }
      else { ctx.fillRect(20, 40 + offset, 180, 140); ctx.fillStyle = 'white'; for (let y = 60; y < 170; y += 15) ctx.fillRect(40, y + offset, 145, 5); }
    }
    paint(); timer = setInterval(paint, 33);
    Object.defineProperty(w.navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        if (denyCamera) throw new w.DOMException('Test denial', 'NotAllowedError');
        const stream = source.captureStream(15); streams.push(stream); return stream;
      },
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'synthetic-test', label: 'Synthetic test stream' }],
    } });
    $('camera-start').click();
    await until(() => $('notice').textContent.includes('Доступ к камере запрещён'), 'camera denial');
    assert(!$('camera-start').disabled && $('webcam').hidden, 'Camera denial must recover');
    log('Отказ камеры объяснён, доступен повторный запуск');
    denyCamera = false; $('camera-start').click();
    await until(() => !$('capture-phone').disabled, 'model and camera ready', 90000);
    assert($('model-status').textContent.includes('MobileNet готова'), 'Real MobileNet must load');
    log('Локальная MobileNet загружена и обработала синтетическое видео');
    for (const category of ['phone', 'hand', 'notebook']) {
      kind = category; await wait(200); $(`capture-${category}`).click();
      await until(() => $(`count-${category}`).textContent === '20 кадров' && !$(`upload-${category}`).disabled, `capture ${category}`);
    }
    assert($('total-count').textContent === '60 кадров' && !$('train-button').disabled, 'Training counts');
    log('Собрано 60 настоящих векторов MobileNet: по 20 на каждый класс');
    $('train-button').click(); assert(!$('predict-button').disabled, 'Prediction must be available');
    log('Классификатор обучается на собранных признаках');
    const before = w.tf.memory().numTensors;
    $('predict-button').click();
    for (const [category, name] of [['phone', 'Телефон'], ['hand', 'Рука'], ['notebook', 'Тетрадь']]) {
      kind = category;
      await until(() => $('prediction-title').textContent === name && $(`score-${category}`).textContent === '100%', `prediction ${category}`);
    }
    await wait(1800); $('predict-button').click(); await wait(300);
    assert(w.tf.memory().numTensors <= before + 2, 'Tensors should not leak during prediction');
    log('Распознавание трёх синтетических классов работает; тензоры не накапливаются');
    const blobs = new Map();
    const originalUrl = w.URL.createObjectURL.bind(w.URL);
    w.URL.createObjectURL = blob => { const url = originalUrl(blob); blobs.set(url, blob); return url; };
    let exported;
    const originalClick = w.HTMLAnchorElement.prototype.click;
    w.HTMLAnchorElement.prototype.click = function () {
      if (this.download) exported = blobs.get(this.href); else originalClick.call(this);
    };
    $('export-button').click(); assert(exported, 'Export blob');
    const json = await exported.text(); assert(JSON.parse(json).classes.phone[0].length === 512, 'Export features');
    log('Экспорт содержит 512 признаков на кадр, без исходных изображений');
    function upload(id, files) {
      const data = new w.DataTransfer(); files.forEach(file => data.items.add(file));
      $(id).files = data.files; $(id).dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    upload('import-input', [new w.File(['{"broken":true}'], 'broken.json', { type: 'application/json' })]);
    await until(() => !$('import-button').disabled, 'invalid import');
    assert($('total-count').textContent === '60 кадров' && $('notice').classList.contains('error') && !$('predict-button').disabled, 'Invalid import must preserve current dataset');
    log('Повреждённый импорт не уничтожает обученный набор');
    $('clear-phone').click(); assert($('train-button').disabled && $('predict-button').disabled, 'Deleting data must invalidate model');
    upload('import-input', [new w.File([json], 'saved.json', { type: 'application/json' })]);
    await until(() => !$('train-button').disabled, 'dataset restored'); $('train-button').click();
    assert($('total-count').textContent === '60 кадров', 'Restore count');
    log('Удаление примеров сбрасывает классификатор, импорт восстанавливает набор');
    kind = 'phone'; paint(); const png = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    upload('test-input', [new w.File([png], 'new-photo.png', { type: 'image/png' })]);
    await until(() => !$('test-preview').hidden && !$('test-button').disabled, 'photo prediction');
    assert($('prediction-title').textContent === 'Телефон' && $('total-count').textContent === '60 кадров', 'Test photos must not train');
    log('Проверка PNG работает и не добавляет тестовое фото в обучение');
    upload('files-phone', [new w.File([png], 'extra-photo.png', { type: 'image/png' })]);
    await until(() => $('count-phone').textContent === '21 кадров' && !$('upload-phone').disabled, 'training photo');
    assert($('predict-button').disabled, 'New training sample must invalidate trained classifier');
    log('Загрузка фотографии пополняет класс и требует повторного обучения');
    $('capture-phone').click();
    await until(() => $('capture-phone').textContent === 'Остановить сбор', 'collection starts');
    $('camera-stop').click();
    await until(() => !$('import-button').disabled, 'collection cancellation');
    const stoppedCount = $('count-phone').textContent; await wait(500);
    assert($('count-phone').textContent === stoppedCount, 'Stopped collection must not append data');
    assert(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Camera streams must stop');
    log('Выключение камеры останавливает сбор и освобождает видеопоток');
    upload('import-input', [new w.File([json], 'saved.json', { type: 'application/json' })]);
    await until(() => !$('train-button').disabled, 'restore after camera stop'); $('train-button').click();
    upload('test-input', [new w.File([png], 'without-camera.png', { type: 'image/png' })]);
    await until(() => !$('test-button').disabled && $('stage-label').textContent === 'Проверка фотографии', 'photo-only flow');
    assert($('prediction-title').textContent === 'Телефон' && $('camera-stop').hidden, 'Photo recognition without camera');
    log('Полный режим без камеры: сохранённый набор → фотография → ответ');
    assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    log('Нет необработанных ошибок JavaScript');
    summary.textContent = `PASS · ${passed} проверок`;
    w.HTMLAnchorElement.prototype.click = originalClick;
  } catch (error) {
    summary.textContent = `FAIL · ${passed} проверок пройдено`; summary.className = 'failed';
    output.textContent += `✗ ${error.stack || error.message}\n`;
  } finally {
    clearInterval(timer); streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    button.textContent = 'Проверки завершены. Обнови страницу для повторного запуска.';
  }
});
