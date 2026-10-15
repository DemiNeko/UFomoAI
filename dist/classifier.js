// MobileNet v1 alpha=0.50 + spatial average pooling -> 512 features.
export const FEATURE_SIZE = 512;
export const MODEL_ID = 'mobilenet-v1-050-224-avgpool';
export const CLASSES = [
  { id: 'phone', name: 'Телефон', color: 'peach', hint: 'Поверни экраном и обратной стороной' },
  { id: 'hand', name: 'Рука', color: 'lilac', hint: 'Раскрой ладонь, меняй угол и расстояние' },
  { id: 'notebook', name: 'Тетрадь', color: 'mint', hint: 'Покажи обложку и открытые страницы' },
];
export const MIN_SAMPLES = 5;
export const MAX_SAMPLES = 300;

export function normalize(values) {
  if (!values || values.length !== FEATURE_SIZE) throw new Error('Неверная размерность признаков.');
  let norm = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('В признаках есть некорректные числа.');
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('Изображение не содержит пригодных признаков.');
  norm = Math.sqrt(norm);
  return Float32Array.from(values, value => value / norm);
}

export function buildClassifier(dataset) {
  const samples = [];
  for (const category of CLASSES) {
    const rows = dataset[category.id];
    if (!Array.isArray(rows) || rows.length < MIN_SAMPLES || rows.length > MAX_SAMPLES) {
      throw new Error(`«${category.name}»: нужно от ${MIN_SAMPLES} до ${MAX_SAMPLES} примеров.`);
    }
    for (const row of rows) samples.push({ label: category.id, vector: normalize(row) });
  }
  return samples;
}

export function predict(samples, input, k = 5) {
  if (!samples.length || !Number.isInteger(k) || k < 1) throw new Error('Классификатор не готов.');
  const vector = normalize(input);
  const neighbors = samples.map(sample => {
    let similarity = 0;
    for (let i = 0; i < FEATURE_SIZE; i++) similarity += vector[i] * sample.vector[i];
    return { label: sample.label, similarity: Math.max(-1, Math.min(1, similarity)) };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, k);
  const scores = Object.fromEntries(CLASSES.map(item => [item.id, 0]));
  for (const neighbor of neighbors) scores[neighbor.label] += 1 / neighbors.length;
  const ordered = CLASSES.map(item => ({ id: item.id, score: scores[item.id] })).sort((a, b) => b.score - a.score);
  const confident = ordered[0].score >= 0.8 && neighbors[0].similarity >= 0.65;
  return { label: ordered[0].id, scores, confident, similarity: neighbors[0].similarity, neighbors };
}

export function serializeDataset(dataset) {
  buildClassifier(dataset);
  return JSON.stringify({ format: 'teach-ai-dataset', version: 1, model: MODEL_ID, featureSize: FEATURE_SIZE,
    classes: Object.fromEntries(CLASSES.map(item => [item.id, dataset[item.id].map(row => Array.from(row))])) });
}

export function parseDataset(text) {
  if (text.length > 16 * 1024 * 1024) throw new Error('Файл слишком большой (максимум 16 МБ).');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Не удалось прочитать JSON-файл.'); }
  if (data?.format !== 'teach-ai-dataset' || data.version !== 1 || data.model !== MODEL_ID || data.featureSize !== FEATURE_SIZE || !data.classes) {
    throw new Error('Этот файл не подходит. Выбери набор, сохранённый в этой лаборатории.');
  }
  buildClassifier(data.classes);
  return Object.fromEntries(CLASSES.map(item => [item.id, data.classes[item.id].map(normalize)]));
}
