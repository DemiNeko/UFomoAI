import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_SIZE, CLASSES, MAX_SAMPLES, normalize, buildClassifier, predict, serializeDataset, parseDataset } from '../dist/classifier.js';

const vector = axis => { const result = new Array(FEATURE_SIZE).fill(0); result[axis] = 1; return result; };
const fixture = () => Object.fromEntries(CLASSES.map((item, i) => [item.id, Array.from({ length: 5 }, () => vector(i))]));

test('New vectors are classified from normalized nearest examples, regardless of magnitude', () => {
  const samples = buildClassifier(fixture());
  for (const [axis, category] of CLASSES.entries()) {
    const input = vector(axis).map(value => value * 30);
    const result = predict(samples, input);
    assert.equal(result.label, category.id);
    assert.equal(result.confident, true);
    assert.equal(result.scores[category.id], 1);
    assert.equal(Object.values(result.scores).reduce((a, b) => a + b), 1);
  }
});
test('Unrelated inputs are not presented as confident even when all neighbors vote for a class', () => {
  const result = predict(buildClassifier(fixture()), vector(12));
  assert.equal(result.confident, false);
  assert.equal(result.similarity, 0);
});
test('A split vote produces uncertainty', () => {
  const samples = ['phone', 'phone', 'hand', 'hand', 'notebook'].map(label => ({ label, vector: normalize(vector(0)) }));
  const result = predict(samples, vector(0));
  assert.equal(result.confident, false);
  assert.equal(result.scores.phone, 0.4);
});
test('Export/import preserves the predictions', () => {
  const restored = parseDataset(serializeDataset(fixture()));
  assert.equal(predict(buildClassifier(restored), vector(2)).label, 'notebook');
  assert.equal(restored.phone.length, 5);
});
test('Invalid, incomplete or excessive imports are rejected before replacement', () => {
  const serialized = serializeDataset(fixture());
  assert.throws(() => parseDataset('broken'), /JSON/);
  for (const mutate of [
    data => { data.model = 'other-model'; },
    data => { data.classes.phone[0] = [1, 2]; },
    data => { data.classes.phone[0][0] = null; },
    data => { data.classes.phone[0].fill(0); },
    data => { data.classes.phone.length = 4; },
    data => { data.classes.hand = Array(MAX_SAMPLES + 1).fill(vector(1)); },
  ]) {
    const data = JSON.parse(serialized); mutate(data);
    assert.throws(() => parseDataset(JSON.stringify(data)));
  }
  assert.throws(() => normalize(Array(FEATURE_SIZE).fill(Infinity)));
});
