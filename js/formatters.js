/**
 * LDAH shared input formatters — name and phone.
 * Idempotent: running twice is safe. Intended for onBlur handlers.
 * Keep this file identical across W2, LDAH App, and LDAH-Int.
 */
(function (global) {
  'use strict';

  var PARTICLES = ['de','del','dela','delas','delos','della','di','du','la','las','le','van','von','der','den','da','das','do','dos','of','the'];
  var ROMAN = /^(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/i;
  var HONORIFIC = /^(jr|sr|dr|mr|mrs|ms|rev|prof|hon)\.?$/i;

  function capOneWord(token, isFirst) {
    if (!token) return '';
    var lower = token.toLowerCase();

    // Roman numerals / suffixes — ALL CAPS
    if (ROMAN.test(token)) return token.toUpperCase();

    // Honorifics — Jr., Sr., Dr., etc.
    if (HONORIFIC.test(token)) {
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    // Mc prefix — McDonald, McArthur
    if (/^mc[a-z]{2,}/i.test(lower)) {
      return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3);
    }

    // O' prefix — O'Brien, O'Connor
    if (/^o'[a-z]/i.test(lower)) {
      return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }

    // D' prefix — D'Angelo, D'Amico
    if (/^d'[a-z]/i.test(lower)) {
      return "D'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }

    // Default — capitalize first letter only
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function formatNameSmart(input) {
    if (input == null) return input;
    var str = String(input).trim().replace(/\s+/g, ' ');
    if (!str) return '';

    // Split by spaces, each word gets processed, hyphens handled within words
    var words = str.split(' ').map(function (word, idx) {
      if (word.indexOf('-') !== -1) {
        return word.split('-').map(function (p) { return capOneWord(p, false); }).join('-');
      }
      return capOneWord(word, idx === 0);
    });

    // Second pass — lowercase particles unless first word
    return words.map(function (w, idx) {
      if (idx > 0 && PARTICLES.indexOf(w.toLowerCase()) !== -1) {
        return w.toLowerCase();
      }
      return w;
    }).join(' ');
  }

  function formatPhone(input) {
    if (input == null) return input;
    var raw = String(input);
    if (!raw.trim()) return '';

    var digits = raw.replace(/\D/g, '');

    // Strip leading 1 on 11-digit US numbers
    if (digits.length === 11 && digits.charAt(0) === '1') {
      digits = digits.slice(1);
    }

    // Only format clean 10-digit US numbers
    if (digits.length === 10) {
      return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
    }

    // Leave everything else alone — extensions, international, partial entries
    return raw.trim();
  }

  /**
   * Attach onBlur formatting to an input element.
   * @param {HTMLInputElement} el
   * @param {'name'|'phone'} kind
   */
  function attachFormatter(el, kind) {
    if (!el || el.dataset.ldahFormatted === '1') return;
    var fn = kind === 'phone' ? formatPhone : formatNameSmart;
    el.addEventListener('blur', function () {
      var formatted = fn(el.value);
      if (formatted !== el.value) el.value = formatted;
    });
    el.dataset.ldahFormatted = '1';
  }

  var api = {
    formatNameSmart: formatNameSmart,
    formatPhone: formatPhone,
    attachFormatter: attachFormatter
  };

  global.LDAHFormat = api;
})(typeof window !== 'undefined' ? window : this);
