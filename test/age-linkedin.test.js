import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYear, parseStart, ageFromEducation, startYear, earliestStart, tenureText, band,
} from '../src/signals/age.linkedin.js';

test('parseYear e parseStart: anni, mesi numerici e nomi di mese', () => {
  assert.equal(parseYear('2018'), 2018);
  assert.equal(parseYear('Sept 2018'), 2018);
  assert.equal(parseYear(null), null);
  assert.deepEqual(parseStart('2025-03'), { year: 2025, month: 3 });
  assert.deepEqual(parseStart('March 2025'), { year: 2025, month: 3 });
  assert.deepEqual(parseStart('gennaio 2025'), { year: 2025, month: 1 });
  assert.deepEqual(parseStart('since 2024'), { year: 2024, month: null });
  assert.equal(parseStart('n.d.'), null);
});

test('età dalla PRIMA esperienza educativa: inizio studi + 18', () => {
  assert.equal(ageFromEducation({ start_year: 2018, degree: 'BSc' }, 2026), 26);
  assert.equal(ageFromEducation({ start_year: '2018', degree: 'MSc' }, 2026), 26);
  assert.equal(band(ageFromEducation({ start_year: 2018 }, 2026)), 'sotto 30');
  assert.equal(ageFromEducation({ start: 2010 }, 2026), 34);
});

test('età dal solo anno di fine: offset del titolo (22/24/28)', () => {
  assert.equal(ageFromEducation({ end_year: 2023, degree: 'BSc' }, 2026), 25);
  assert.equal(ageFromEducation({ end_year: 2023, degree: 'Bachelor of Science' }, 2026), 25);
  assert.equal(ageFromEducation({ end_year: 2020, degree: 'MSc' }, 2026), 30);
  assert.equal(ageFromEducation({ end_year: 2020, degree: 'Master' }, 2026), 30);
  assert.equal(ageFromEducation({ end_year: 2021, degree: 'B.Eng.' }, 2026), 27);
  assert.equal(ageFromEducation({ end_year: 2020, degree: 'M.Eng.' }, 2026), 30);
  assert.equal(ageFromEducation({ end_year: 2019, degree: 'PhD' }, 2026), 35);
  assert.equal(ageFromEducation({ end_year: 2023 }, 2026), 25, 'senza titolo: laurea triennale');
});

test('età non determinabile: dati mancanti o fuori scala', () => {
  assert.equal(ageFromEducation(null, 2026), null);
  assert.equal(ageFromEducation({}, 2026), null);
  assert.equal(ageFromEducation({ start_year: 1950 }, 2026), null, 'oltre 80 anni: scarta');
  assert.equal(ageFromEducation({ start_year: 2025 }, 2026), 19);
});

test('anzianità in azienda e anno di fondazione più antico', () => {
  assert.equal(startYear('2025-03'), 2025);
  assert.equal(startYear('n.d.'), null);
  assert.equal(earliestStart([{ start_at_company: '2025-03' }, { start_at_company: '2024' }]), 2024);
  assert.equal(earliestStart([{ start_at_company: 'n.d.' }]), null);
  assert.equal(tenureText('2025-03', 2026, 11), 'dal 2025-03 (1 anno)');
  assert.equal(tenureText('2026-12', 2026, 11), 'dal 2026-12 (meno di 1 anno)');
  assert.equal(tenureText('2024', 2026, 11), 'dal 2024 (2 anni)');
  assert.equal(tenureText('n.d.'), '');
});
