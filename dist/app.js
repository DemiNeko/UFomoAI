import { CLASSES, MIN_SAMPLES, MAX_SAMPLES, FEATURE_SIZE, buildClassifier, predict, serializeDataset, parseDataset } from './classifier.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const dataset = Object.fromEntries(CLASSES.map(item => [item.id, []]));
const thumbnails = Object.fromEntries(CLASSES.map(item => [item.id, []]));
let modelPromise = null;
let featureModel = null;
let samples = null;
let stream = null;
let busy = false;
let collecting = null;
let predicting = false;
let runId = 0;
let saved = true;
let lastPhotoUrl = null;
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 224;
const context = canvas.getContext('2d', { willReadFrequently: true });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

for (const category of CLASSES) {
  const card = document.createElement('article');
  card.className = `class-card ${category.color}`;
  card.id = `card-${category.id}`;
  card.innerHTML = `<div class="class-top"><span class="class-icon">${icon(category.id)}</span><span class="class-name">${category.name}</span><span class="class-count" id="count-${category.id}">0 кадров</span><button class="clear-class" id="clear-${category.id}" aria-label="Удалить примеры: ${category.name}" title="Удалить примеры" disabled>×</button></div><div class="thumbnails" id="thumbs-${category.id}" aria-label="Последние примеры"></div><div class="class-actions"><button class="capture-button" id="capture-${category.id}" disabled>+ 20 кадров</button><button class="upload-class" id="upload-${category.id}" title="Добавить фотографии: ${category.name}" aria-label="Добавить фотографии: ${category.name}">${icon('upload')}</button><input type="file" id="files-${category.id}" accept="image/*" multiple hidden></div><p class="class-hint">${category.hint}</p>`;
  $('class-cards').append(card);
  const row = document.createElement('div');
  row.className = 'score-row';
  row.innerHTML = `<div class="score-label">${icon(category.id)}<span>${category.name}</span><span class="score-value" id="score-${category.id}">—</span></div><div class="score-track"><div class="score-fill ${category.color}" id="bar-${category.id}"></div></div>`;
  $('score-bars').append(row);
  $(`capture-${category.id}`).addEventListener('click', () => collect(category.id));
  $(`upload-${category.id}`).addEventListener('click', () => $(`files-${category.id}`).click());
  $(`files-${category.id}`).addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (files.length) await addPhotos(category.id, files);
  });
  $(`clear-${category.id}`).addEventListener('click', () => {
    dataset[category.id] = []; thumbnails[category.id] = []; saved = false;
    invalidate(); render(); announce(`Примеры класса «${category.name}» удалены.`);
  });
}

function announce(message, error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}

function render() {
  const total = CLASSES.reduce((sum, item) => sum + dataset[item.id].length, 0);
  const ready = CLASSES.filter(item => dataset[item.id].length >= MIN_SAMPLES).length;
  const progress = CLASSES.reduce((sum, item) => sum + Math.min(MIN_SAMPLES, dataset[item.id].length), 0);
  $('total-count').textContent = `${total} кадров`;
  $('training-progress-label').textContent = samples ? 'Классификатор готов' : `Готово ${ready} из 3 классов`;
  $('training-count').textContent = `${progress} / 15`;
  $('training-track').style.width = `${progress / 15 * 100}%`;
  $('train-button').disabled = ready < 3 || busy || predicting || !!samples;
  $('train-hint').textContent = samples ? 'Теперь проверь предмет под новым углом.' : 'Для начала — минимум 5 кадров на класс.';
  $('predict-button').disabled = !samples || !stream || busy;
  $('predict-button').innerHTML = predicting ? 'Остановить распознавание' : `Начать распознавание ${icon('arrow')}`;
  $('test-button').disabled = !samples || busy;
  $('import-button').disabled = busy || predicting;
  $('export-button').disabled = ready < 3 || busy;
  $('camera-start').disabled = busy;
  $('camera-restart').disabled = busy;
  $('camera-select').disabled = busy || predicting;
  $('step-1').className = ready < 3 ? 'active' : 'done';
  $('step-2').className = ready === 3 && !samples ? 'active' : samples ? 'done' : '';
  $('step-3').className = samples ? 'active' : '';
  for (const item of CLASSES) {
    const count = dataset[item.id].length;
    $(`count-${item.id}`).textContent = `${count} кадров`;
    $(`capture-${item.id}`).disabled = !stream || predicting || (busy && collecting !== item.id) || (count >= MAX_SAMPLES && collecting !== item.id);
    $(`capture-${item.id}`).textContent = collecting === item.id ? 'Остановить сбор' : count >= MAX_SAMPLES ? 'Лимит: 300 кадров' : '+ 20 кадров';
    $(`upload-${item.id}`).disabled = busy || predicting || count >= MAX_SAMPLES;
    $(`clear-${item.id}`).disabled = !count || busy || predicting;
    $(`card-${item.id}`).classList.toggle('collecting', collecting === item.id);
    const container = $(`thumbs-${item.id}`);
    container.replaceChildren();
    if (count && !thumbnails[item.id].length) {
      const label = document.createElement('span'); label.className = 'loaded-label';
      label.textContent = '✓ Признаки загружены из файла'; container.append(label);
    } else {
      for (let i = 0; i < 5; i++) {
        const source = thumbnails[item.id][i];
        const element = document.createElement(source ? 'img' : 'span');
        element.className = `thumbnail${source ? ' filled' : ''}`;
        if (source) { element.src = source; element.alt = `Пример: ${item.name}`; }
        else element.setAttribute('aria-hidden', 'true');
        container.append(element);
      }
    }
  }
}

function clearResult() {
  $('prediction-title').textContent = 'Пока не знаю';
  $('prediction-detail').textContent = 'Добавь примеры каждого класса и обучи свой классификатор.';
  document.querySelector('.prediction-symbol').textContent = '?';
  $('latency').textContent = '';
  for (const item of CLASSES) {
    $(`score-${item.id}`).textContent = '—'; $(`bar-${item.id}`).style.width = '0%';
  }
}

function invalidate() { stopPrediction(); samples = null; clearResult(); }

async function ensureModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    $('model-orb').className = 'status-orb loading';
    $('model-status').textContent = 'Загружаем MobileNet…'; $('retry-model').hidden = true;
    const tf = window.tf;
    if (!tf) throw new Error('Не загрузилась библиотека TensorFlow.js. Обнови страницу.');
    await tf.ready();
    const base = await tf.loadLayersModel(new URL('./model/model.json', import.meta.url).href, {
      onProgress: fraction => { $('model-status').textContent = `Загружаем MobileNet · ${Math.round(fraction * 100)}%`; },
    });
    // Use frozen convolutional features, then average over the spatial dimensions.
    featureModel = tf.model({ inputs: base.inputs, outputs: base.getLayer('conv_pw_13_relu').output });
    const warmup = tf.tidy(() => featureModel.predict(tf.zeros([1, 224, 224, 3])).mean([1, 2]));
    try { await warmup.data(); } finally { warmup.dispose(); }
    $('model-orb').className = 'status-orb ready';
    $('model-status').textContent = 'MobileNet готова · вычисления на твоём устройстве';
    return featureModel;
  })().catch(error => {
    modelPromise = null;
    $('model-orb').className = 'status-orb error'; $('model-status').textContent = 'Не удалось загрузить нейросеть';
    $('retry-model').hidden = false;
    throw error;
  });
  return modelPromise;
}

function drawSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) throw new Error('Кадр ещё не готов. Попробуй ещё раз.');
  const side = Math.min(width, height);
  context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 224, 224);
}

async function extract(source) {
  await ensureModel();
  drawSource(source);
  const tensor = window.tf.tidy(() => {
    const input = window.tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims();
    return featureModel.predict(input).mean([1, 2]);
  });
  try {
    const vector = Float32Array.from(await tensor.data());
    if (vector.length !== FEATURE_SIZE) throw new Error('Неподходящая версия MobileNet.');
    return vector;
  } finally { tensor.dispose(); }
}

function remember(id, vector) {
  if (dataset[id].length >= MAX_SAMPLES) return;
  dataset[id].push(vector);
  thumbnails[id].unshift(canvas.toDataURL('image/jpeg', 0.55));
  thumbnails[id].length = Math.min(5, thumbnails[id].length);
  saved = false; invalidate(); render();
}

const cameraErrors = {
  NotAllowedError: 'Доступ к камере запрещён. Разреши его в настройках браузера или добавь фотографии кнопкой рядом с классом.',
  NotFoundError: 'Камера не найдена. Можно добавить фотографии кнопкой рядом с каждым классом.',
  NotReadableError: 'Камера занята другим приложением. Закрой его и попробуй снова.',
  OverconstrainedError: 'Эта камера недоступна. Выбери другую или добавь фотографии.',
};

async function startCamera(deviceId) {
  if (busy) return;
  busy = true; render(); announce('');
  let acquired = null;
  let playing = false;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Камера работает через HTTPS или localhost. Запусти проект командой npm start либо открой GitHub Pages.');
    stopCamera();
    acquired = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    stream = acquired;
    const video = $('webcam'); video.srcObject = stream;
    await video.play();
    playing = true;
    video.hidden = false; $('test-preview').hidden = true; $('camera-placeholder').hidden = true;
    $('stage-badge').hidden = false; $('stage-label').textContent = 'Камера готова';
    $('camera-stop').hidden = false; $('camera-restart').hidden = true;
    $('camera-state').innerHTML = '<span></span> Камера включена'; $('camera-state').classList.add('is-on');
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { stopCamera(); render(); });
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      $('camera-select').replaceChildren(...devices.map((device, index) => new Option(device.label || `Камера ${index + 1}`, device.deviceId)));
      $('camera-select').value = stream.getVideoTracks()[0].getSettings().deviceId || '';
      $('camera-select').hidden = devices.length < 2;
    } catch { $('camera-select').hidden = true; }
    await ensureModel();
    announce('Камера готова. Покажи телефон и нажми «+ 20 кадров» у его класса. Во время сбора медленно меняй ракурс.');
  } catch (error) {
    if (!playing) {
      if (acquired) acquired.getTracks().forEach(track => track.stop());
      stopCamera();
    }
    announce(cameraErrors[error.name] || error.message, true);
  } finally { busy = false; render(); }
}

function stopCamera() {
  collecting = null; stopPrediction();
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; $('webcam').srcObject = null; $('webcam').hidden = true;
  $('camera-placeholder').hidden = !$('test-preview').hidden;
  $('camera-stop').hidden = true; $('camera-restart').hidden = $('test-preview').hidden;
  $('camera-select').hidden = true; $('stage-badge').hidden = true;
  $('camera-state').innerHTML = '<span></span> Камера выключена'; $('camera-state').classList.remove('is-on');
  $('capture-overlay').hidden = true;
}

async function collect(id) {
  if (collecting === id) { collecting = null; render(); return; }
  if (busy || !stream || predicting) return;
  busy = true; collecting = id; render(); announce('');
  try {
    await ensureModel();
    $('webcam').hidden = false; $('test-preview').hidden = true; $('camera-placeholder').hidden = true;
    $('stage-badge').hidden = false; $('stage-label').textContent = 'Камера готова';
    const count = Math.min(20, MAX_SAMPLES - dataset[id].length);
    for (let i = 0; i < count && collecting === id && stream; i++) {
      const vector = await extract($('webcam'));
      if (collecting !== id || !stream) break;
      remember(id, vector);
      $('capture-overlay').hidden = false;
      $('capture-overlay').textContent = `Собираем «${CLASSES.find(item => item.id === id).name}» · ${i + 1} / ${count}`;
      await pause(160);
    }
    if (CLASSES.every(item => dataset[item.id].length >= MIN_SAMPLES)) announce('Примеры собраны! Нажми «Обучить классификатор», а затем проверь предметы под новыми углами.');
  } catch (error) { announce(`Не удалось собрать кадры: ${error.message}`, true); }
  finally { collecting = null; busy = false; $('capture-overlay').hidden = true; render(); }
}

async function readImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Выбери изображение в формате JPEG, PNG или WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Изображение слишком большое (максимум 15 МБ).');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return { img, url };
  } catch { URL.revokeObjectURL(url); throw new Error('Браузер не смог открыть это изображение. Попробуй JPEG или PNG.'); }
}

async function addPhotos(id, files) {
  if (busy || predicting) return;
  busy = true; render();
  let added = 0, failed = 0;
  try {
    await ensureModel();
    for (const file of files.slice(0, MAX_SAMPLES - dataset[id].length)) {
      announce(`Обрабатываем фотографии: ${added + failed + 1} из ${Math.min(files.length, MAX_SAMPLES - dataset[id].length + added)}`);
      let image;
      try {
        image = await readImage(file); remember(id, await extract(image.img)); added++;
      } catch { failed++; }
      finally { if (image) URL.revokeObjectURL(image.url); }
      await pause(0);
    }
    announce(`Добавлено фотографий: ${added}.${failed ? ` Не удалось прочитать: ${failed}. Используй JPEG, PNG или WebP до 15 МБ.` : ' Обрати внимание: обрабатывается центральный квадрат изображения.'}${added + failed < files.length ? ' Достигнут лимит 300 примеров на класс.' : ''}`, !added);
  } catch (error) { announce(error.message, true); }
  finally { busy = false; render(); }
}

function train() {
  if (busy) return;
  try {
    samples = buildClassifier(dataset);
    $('prediction-title').textContent = 'Готов к проверке';
    $('prediction-detail').textContent = 'Включи распознавание или выбери новое фото.';
    document.querySelector('.prediction-symbol').innerHTML = icon('spark');
    announce(`Классификатор готов: ${samples.length} примеров, 3 класса. Проверь на новых кадрах, которых не было в обучении.`);
  } catch (error) { announce(error.message, true); }
  render();
}

function showResult(result, elapsed) {
  const category = CLASSES.find(item => item.id === result.label);
  $('prediction-title').textContent = result.confident ? category.name : 'Не уверен';
  $('prediction-detail').textContent = result.confident ? `Большинство соседей выбрало класс «${category.name}».` : 'Примеры расходятся или мало похожи. Покажи предмет ближе, добавь другие ракурсы.';
  document.querySelector('.prediction-symbol').innerHTML = result.confident ? icon(category.id) : '?';
  for (const item of CLASSES) {
    const percent = Math.round(result.scores[item.id] * 100);
    $(`score-${item.id}`).textContent = `${percent}%`; $(`bar-${item.id}`).style.width = `${percent}%`;
  }
  $('latency').textContent = `${Math.round(elapsed)} мс на кадр · 5 соседей`;
}

function stopPrediction() {
  predicting = false; runId++;
  $('stage-label').textContent = 'Камера готова';
}

async function togglePrediction() {
  if (predicting) { stopPrediction(); render(); return; }
  if (busy || !samples || !stream) return;
  busy = true; render(); announce('');
  try { await ensureModel(); }
  catch (error) { announce(error.message, true); busy = false; render(); return; }
  busy = false;
  if (!stream || !samples) { render(); return; }
  predicting = true; const currentRun = ++runId;
  $('webcam').hidden = false; $('test-preview').hidden = true; $('camera-placeholder').hidden = true;
  $('stage-badge').hidden = false; $('stage-label').textContent = 'Распознавание'; render();
  while (predicting && stream && currentRun === runId) {
    try {
      const start = performance.now(); const vector = await extract($('webcam'));
      if (!predicting || currentRun !== runId || !samples) break;
      showResult(predict(samples, vector), performance.now() - start);
      await pause(150);
    } catch (error) { announce(`Распознавание остановлено: ${error.message}`, true); stopPrediction(); }
  }
  render();
}

async function testPhoto(file) {
  if (busy || !samples) return;
  stopPrediction(); busy = true; render();
  let image;
  try {
    image = await readImage(file); const start = performance.now();
    const vector = await extract(image.img); showResult(predict(samples, vector), performance.now() - start);
    if (lastPhotoUrl) URL.revokeObjectURL(lastPhotoUrl);
    lastPhotoUrl = image.url;
    $('test-preview').src = image.url; $('test-preview').hidden = false;
    $('webcam').hidden = true; $('camera-placeholder').hidden = true;
    $('stage-badge').hidden = false; $('stage-label').textContent = 'Проверка фотографии';
    $('camera-restart').hidden = !!stream;
    announce('Результат для центрального квадрата фотографии. Для честной проверки используй снимок, которого не было в обучении.');
  } catch (error) { if (image) URL.revokeObjectURL(image.url); announce(error.message, true); }
  finally { busy = false; render(); }
}

$('camera-start').addEventListener('click', () => startCamera());
$('camera-restart').addEventListener('click', () => startCamera());
$('camera-stop').addEventListener('click', () => { stopCamera(); render(); });
$('camera-select').addEventListener('change', event => startCamera(event.target.value));
$('train-button').addEventListener('click', train);
$('predict-button').addEventListener('click', togglePrediction);
$('test-button').addEventListener('click', () => $('test-input').click());
$('test-input').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) testPhoto(file); });
$('retry-model').addEventListener('click', async () => {
  if (busy) return; busy = true; render();
  try { await ensureModel(); announce('Нейросеть готова. Можно продолжать.'); }
  catch (error) { announce(error.message, true); }
  finally { busy = false; render(); }
});
$('export-button').addEventListener('click', () => {
  try {
    const blob = new Blob([serializeDataset(dataset)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'teach-ai-phone-hand-notebook.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); saved = true;
    announce('Набор сохранён. Он содержит числовые признаки и метки классов. Загрузи его перед защитой — повторно собирать примеры не потребуется.');
  } catch (error) { announce(error.message, true); }
});
$('import-button').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || busy) return;
  if (file.size > 16 * 1024 * 1024) { announce('Файл слишком большой (максимум 16 МБ).', true); return; }
  busy = true; render();
  try {
    const next = parseDataset(await file.text());
    // Validate completely before replacing existing work.
    invalidate();
    for (const item of CLASSES) { dataset[item.id] = next[item.id]; thumbnails[item.id] = []; }
    saved = true; announce('Набор загружен. Нажми «Обучить классификатор», затем включи камеру или выбери фотографию.');
  } catch (error) { announce(error.message, true); }
  finally { busy = false; render(); }
});
const dialog = $('defense-dialog');
$('defense-open').addEventListener('click', () => dialog.showModal());
$('defense-close').addEventListener('click', () => dialog.close());
$('defense-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', event => { if (!saved && CLASSES.some(item => dataset[item.id].length)) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { collecting = null; stopPrediction(); render(); } });
render();
