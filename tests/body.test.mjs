import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyFatNavy, bmi, semiAxis, valuesAt, series, bodyDims } from '../js/body.js';

const near = (a, b, eps = 0.2) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('masse grasse (méthode U.S. Navy), homme et femme', () => {
  near(bodyFatNavy('m', 178, { neck: 38, waist: 85 }), 16.4);
  near(bodyFatNavy('f', 165, { neck: 32, waist: 70, hips: 96 }), 25.4);
  assert.equal(bodyFatNavy('f', 165, { neck: 32, waist: 70 }), null); // hanches nécessaires
  assert.equal(bodyFatNavy('m', 178, { neck: 40, waist: 38 }), null); // incohérent
});

test('IMC', () => {
  near(bmi(75, 176), 24.2, 0.05);
  assert.equal(bmi(null, 176), null);
});

test('ellipse : un cercle de périmètre 2π a un rayon de 1', () => {
  near(semiAxis(2 * Math.PI, 1), 1, 1e-9);
  assert.ok(semiAxis(100, 0.72) > 100 / (2 * Math.PI)); // ellipse aplatie : plus large qu'un cercle
});

test('valeurs connues : chaque mesure garde sa dernière saisie, même partielle', () => {
  const m = [
    { id: '1', date: '2026-10-01', weight: 80, waist: 90 },
    { id: '2', date: '2026-11-01', weight: 78 },
    { id: '3', date: '2026-11-10', waist: 86, deleted: true },
  ];
  assert.deepEqual(valuesAt(m), { weight: 78, waist: 90 });
  assert.deepEqual(valuesAt(m, Date.parse('2026-10-15')), { weight: 80, waist: 90 });
  assert.deepEqual(series(m, 'weight').map((p) => p.value), [80, 78]);
});

test('mannequin : les mesures font varier les dimensions, défauts selon le sexe', () => {
  const thin = bodyDims({ waist: 70 }, { sex: 'm', heightCm: 180 });
  const big = bodyDims({ waist: 100 }, { sex: 'm', heightCm: 180 });
  assert.ok(big.torso.waist > thin.torso.waist);
  near(big.height, 1.8, 1e-9);
  near(bodyDims({}, { sex: 'f' }).height, 1.64, 1e-9);
  assert.ok(bodyDims({}, { sex: 'f' }).torso.shoulders < bodyDims({}, { sex: 'm' }).torso.shoulders);
});
