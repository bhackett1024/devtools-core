/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Dependencies
const validProtocols = /^(http|https|ftp|data|javascript|resource|chrome):/i;
const tokenSplitRegex = /(\s|\'|\"|\\)+/;
const ELLIPSIS = "\u2026";
const dom = require("react-dom-factories");
const { span } = dom;

/**
 * Returns true if the given object is a grip (see RDP protocol)
 */
function isGrip(object) {
  return object && object.actor;
}

function escapeNewLines(value) {
  return value.replace(/\r/gm, "\\r").replace(/\n/gm, "\\n");
}

// Map from character code to the corresponding escape sequence.  \0
// isn't here because it would require special treatment in some
// situations.  \b, \f, and \v aren't here because they aren't very
// common.  \' isn't here because there's no need, we only
// double-quote strings.
const escapeMap = {
  // Tab.
  9: "\\t",
  // Newline.
  0xa: "\\n",
  // Carriage return.
  0xd: "\\r",
  // Quote.
  0x22: "\\\"",
  // Backslash.
  0x5c: "\\\\",
};

// Regexp that matches any character we might possibly want to escape.
// Note that we over-match here, because it's difficult to, say, match
// an unpaired surrogate with a regexp.  The details are worked out by
// the replacement function; see |escapeString|.
const escapeRegexp = new RegExp(
  "[" +
  // Quote and backslash.
  "\"\\\\" +
  // Controls.
  "\x00-\x1f" +
  // More controls.
  "\x7f-\x9f" +
  // BOM
  "\ufeff" +
  // Specials, except for the replacement character.
  "\ufff0-\ufffc\ufffe\uffff" +
  // Surrogates.
  "\ud800-\udfff" +
  // Mathematical invisibles.
  "\u2061-\u2064" +
  // Line and paragraph separators.
  "\u2028-\u2029" +
  // Private use area.
  "\ue000-\uf8ff" +
  "]", "g");

/**
 * Escape a string so that the result is viewable and valid JS.
 * Control characters, other invisibles, invalid characters,
 * backslash, and double quotes are escaped.  The resulting string is
 * surrounded by double quotes.
 *
 * @param {String} str
 *        the input
 * @param {Boolean} escapeWhitespace
 *        if true, TAB, CR, and NL characters will be escaped
 * @return {String} the escaped string
 */
function escapeString(str, escapeWhitespace) {
  return "\"" + str.replace(escapeRegexp, (match, offset) => {
    let c = match.charCodeAt(0);
    if (c in escapeMap) {
      if (!escapeWhitespace && (c === 9 || c === 0xa || c === 0xd)) {
        return match[0];
      }
      return escapeMap[c];
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      // Find the full code point containing the surrogate, with a
      // special case for a trailing surrogate at the start of the
      // string.
      if (c >= 0xdc00 && offset > 0) {
        --offset;
      }
      let codePoint = str.codePointAt(offset);
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
        // Unpaired surrogate.
        return "\\u" + codePoint.toString(16);
      } else if (codePoint >= 0xf0000 && codePoint <= 0x10fffd) {
        // Private use area.  Because we visit each pair of a such a
        // character, return the empty string for one half and the
        // real result for the other, to avoid duplication.
        if (c <= 0xdbff) {
          return "\\u{" + codePoint.toString(16) + "}";
        }
        return "";
      }
      // Other surrogate characters are passed through.
      return match;
    }
    return "\\u" + ("0000" + c.toString(16)).substr(-4);
  }) + "\"";
}

/**
 * Escape a property name, if needed.  "Escaping" in this context
 * means surrounding the property name with quotes.
 *
 * @param {String}
 *        name the property name
 * @return {String} either the input, or the input surrounded by
 *                  quotes, properly quoted in JS syntax.
 */
function maybeEscapePropertyName(name) {
  // Quote the property name if it needs quoting.  This particular
  // test is an approximation; see
  // https://mathiasbynens.be/notes/javascript-properties.  However,
  // the full solution requires a fair amount of Unicode data, and so
  // let's defer that until either it's important, or the \p regexp
  // syntax lands, see
  // https://github.com/tc39/proposal-regexp-unicode-property-escapes.
  if (!/^\w+$/.test(name)) {
    name = escapeString(name);
  }
  return name;
}

function cropMultipleLines(text, limit) {
  return escapeNewLines(cropString(text, limit));
}

function rawCropString(text, limit, alternativeText = ELLIPSIS) {
  // Crop the string only if a limit is actually specified.
  if (!limit || limit <= 0) {
    return text;
  }

  // Set the limit at least to the length of the alternative text
  // plus one character of the original text.
  if (limit <= alternativeText.length) {
    limit = alternativeText.length + 1;
  }

  let halfLimit = (limit - alternativeText.length) / 2;

  if (text.length > limit) {
    return text.substr(0, Math.ceil(halfLimit)) + alternativeText +
      text.substr(text.length - Math.floor(halfLimit));
  }

  return text;
}

function cropString(text, limit, alternativeText) {
  return rawCropString(sanitizeString(text + ""), limit, alternativeText);
}

function sanitizeString(text) {
  // Replace all non-printable characters, except of
  // (horizontal) tab (HT: \x09) and newline (LF: \x0A, CR: \x0D),
  // with unicode replacement character (u+fffd).
  // eslint-disable-next-line no-control-regex
  let re = new RegExp("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]", "g");
  return text.replace(re, "\ufffd");
}

function parseURLParams(url) {
  url = new URL(url);
  return parseURLEncodedText(url.searchParams);
}

function parseURLEncodedText(text) {
  let params = [];

  // In case the text is empty just return the empty parameters
  if (text == "") {
    return params;
  }

  let searchParams = new URLSearchParams(text);
  let entries = [...searchParams.entries()];
  return entries.map(entry => {
    return {
      name: entry[0],
      value: entry[1]
    };
  });
}

function getFileName(url) {
  let split = splitURLBase(url);
  return split.name;
}

function splitURLBase(url) {
  if (!isDataURL(url)) {
    return splitURLTrue(url);
  }
  return {};
}

function getURLDisplayString(url) {
  return cropString(url);
}

function isDataURL(url) {
  return (url && url.substr(0, 5) == "data:");
}

function splitURLTrue(url) {
  const reSplitFile = /(.*?):\/{2,3}([^\/]*)(.*?)([^\/]*?)($|\?.*)/;
  let m = reSplitFile.exec(url);

  if (!m) {
    return {
      name: url,
      path: url
    };
  } else if (m[4] == "" && m[5] == "") {
    return {
      protocol: m[1],
      domain: m[2],
      path: m[3],
      name: m[3] != "/" ? m[3] : m[2]
    };
  }

  return {
    protocol: m[1],
    domain: m[2],
    path: m[2] + m[3],
    name: m[4] + m[5]
  };
}

/**
 * Wrap the provided render() method of a rep in a try/catch block that will render a
 * fallback rep if the render fails.
 */
function wrapRender(renderMethod) {
  const wrappedFunction = function (props) {
    try {
      return renderMethod.call(this, props);
    } catch (e) {
      console.error(e);
      return span(
        {
          className: "objectBox objectBox-failure",
          title: "This object could not be rendered, " +
                 "please file a bug on bugzilla.mozilla.org"
        },
        /* Labels have to be hardcoded for reps, see Bug 1317038. */
        "Invalid object");
    }
  };
  wrappedFunction.propTypes = renderMethod.propTypes;
  return wrappedFunction;
}

/**
 * Get preview items from a Grip.
 *
 * @param {Object} Grip from which we want the preview items
 * @return {Array} Array of the preview items of the grip, or an empty array
 *                 if the grip does not have preview items
 */
function getGripPreviewItems(grip) {
  if (!grip) {
    return [];
  }

  // Promise resolved value Grip
  if (grip.promiseState && grip.promiseState.value) {
    return [grip.promiseState.value];
  }

  // Array Grip
  if (grip.preview && grip.preview.items) {
    return grip.preview.items;
  }

  // Node Grip
  if (grip.preview && grip.preview.childNodes) {
    return grip.preview.childNodes;
  }

  // Set or Map Grip
  if (grip.preview && grip.preview.entries) {
    return grip.preview.entries.reduce((res, entry) => res.concat(entry), []);
  }

  // Event Grip
  if (grip.preview && grip.preview.target) {
    let keys = Object.keys(grip.preview.properties);
    let values = Object.values(grip.preview.properties);
    return [grip.preview.target, ...keys, ...values];
  }

  // RegEx Grip
  if (grip.displayString) {
    return [grip.displayString];
  }

  // Generic Grip
  if (grip.preview && grip.preview.ownProperties) {
    let propertiesValues = Object.values(grip.preview.ownProperties)
      .map(property => property.value || property);

    let propertyKeys = Object.keys(grip.preview.ownProperties);
    propertiesValues = propertiesValues.concat(propertyKeys);

    // ArrayBuffer Grip
    if (grip.preview.safeGetterValues) {
      propertiesValues = propertiesValues.concat(
        Object.values(grip.preview.safeGetterValues)
          .map(property => property.getterValue || property)
      );
    }

    return propertiesValues;
  }

  return [];
}

/**
 * Get the type of an object.
 *
 * @param {Object} Grip from which we want the type.
 * @param {boolean} noGrip true if the object is not a grip.
 * @return {boolean}
 */
function getGripType(object, noGrip) {
  if (noGrip || Object(object) !== object) {
    return typeof object;
  }
  if (object.type === "object") {
    return object.class;
  }
  return object.type;
}

/**
 * Determines whether a grip is a string containing a URL.
 *
 * @param string grip
 *        The grip, which may contain a URL.
 * @return boolean
 *         Whether the grip is a string containing a URL.
 */
function containsURL(grip) {
  if (typeof grip !== "string") {
    return false;
  }

  let tokens = grip.split(tokenSplitRegex);
  return tokens.some(isURL);
}

/**
 * Determines whether a string token is a valid URL.
 *
 * @param string token
 *        The token.
 * @return boolean
 *         Whenther the token is a URL.
 */
function isURL(token) {
  try {
    if (!validProtocols.test(token)) {
      return false;
    }
    new URL(token);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  isGrip,
  isURL,
  cropString,
  containsURL,
  rawCropString,
  sanitizeString,
  escapeString,
  wrapRender,
  cropMultipleLines,
  parseURLParams,
  parseURLEncodedText,
  getFileName,
  getURLDisplayString,
  maybeEscapePropertyName,
  getGripPreviewItems,
  getGripType,
  tokenSplitRegex,
  ELLIPSIS,
};
