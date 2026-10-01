// Shared expectations for our scanner and the optional official-Python comparison.
// These strings are source data; neither test path evaluates their expressions.
export const pythonInterpolationCases = [
  {
    name: 'literal hashes and escaped braces',
    source: 'x = f"# literal {{# still literal}} {{{value}}}" # outside',
    comments: [' outside'],
  },
  {
    name: 'comments swallow closing quotes and braces',
    source: 'x = f"{value # real }\" still comment\n}" # outside',
    comments: [' real }" still comment', ' outside'],
  },
  {
    name: 'same quote reused in nested strings and interpolations',
    source: 'x = f"{data["# key"] # lookup\n} {f"{other # nested\n}"}" # outside',
    comments: [' lookup', ' nested', ' outside'],
  },
  {
    name: 'dict, slice, comprehension and lambda expression boundaries',
    source: `x = f"""{({'#': [n for n in items # comprehension
]}['#'][1:]) # expression
} {(lambda x: x)('#') # lambda
}"""`,
    comments: [' comprehension', ' expression', ' lambda'],
  },
  {
    name: 'format hashes and quotes are literal',
    source: `x = f"""{number:#06x} {number:'#>8} # literal""" # outside`,
    comments: [' outside'],
  },
  {
    name: 'nested format fields contain expressions and comments',
    source: 'x = f"{value:{width # width\n}.{precision # precision\n}f}" # outside',
    comments: [' width', ' precision', ' outside'],
  },
  {
    name: 'double opening braces inside a format specifier start a dict expression',
    source: 'x = f"{value:{{1: 2 # dict\n}}}" # outside',
    comments: [' dict', ' outside'],
  },
  {
    name: 'nested field with its own format specifier',
    source: 'x = f"{value:{width # width\n:05}}" # outside',
    comments: [' width', ' outside'],
  },
  {
    name: 'multiline triple-quoted format specifier hides hashes',
    source: 'x = f"""{value:\n# literal {width # width\n}\n}""" # outside',
    comments: [' width', ' outside'],
  },
  {
    name: 'debug fields and conversions',
    source: 'x = f"{value = # debug\n!r:>{width # width\n}} {value!s} {value!a}"',
    comments: [' debug', ' width'],
  },
  {
    name: 'equality operators and parenthesised assignment are not debug separators',
    source: 'x = f"{a == b # equal\n} {a != b # unequal\n} {a <= b} {a >= b} {(n := 1) # assigned\n}"',
    comments: [' equal', ' unequal', ' assigned'],
  },
  {
    name: 'unparenthesised colon starts literal formatting even before equals',
    source: 'x = f"{value:=#8}" # outside',
    comments: [' outside'],
  },
  {
    name: 'ordinary, raw, bytes and triple strings inside fields',
    source: `x = f"""{r'# raw'} {b'# bytes'} {'''# docstring
# still string'''} # literal""" # outside`,
    comments: [' outside'],
  },
  {
    name: 'named Unicode escape braces are literal',
    source: String.raw`x = f"\N{NUMBER SIGN} \u0023 \x23 {value # real
}" # outside`,
    comments: [' real', ' outside'],
  },
  {
    name: 'raw named-escape spelling introduces an ordinary replacement field',
    source: String.raw`x = rf"\N{value # real
}" # outside`,
    comments: [' real', ' outside'],
  },
  {
    name: 'a backslash does not escape a replacement brace',
    source: String.raw`x = f"\{value # real
}" # outside`,
    comments: [' real', ' outside'],
  },
  {
    name: 'escaped quotes and backslash parity',
    source: String.raw`x = f"\"# literal \\{value # real
}" # outside`,
    comments: [' real', ' outside'],
  },
  {
    name: 'line continuations in literal text and expressions',
    source: 'x = f"continued\\\n# literal {1 + \\\n2 # expression\n}" # outside',
    comments: [' expression', ' outside'],
  },
  {
    name: 'BOM, Unicode, CRLF and empty expression comment',
    source: '\ufeffx = f"😀 {value #\r\n}" # outside',
    comments: ['', ' outside'],
  },
  {
    name: 'bare CR ends expression comments',
    source: 'x = f"{value # real\r}" # outside',
    comments: [' real', ' outside'],
  },
  {
    name: 'adjacent plain and interpolated literals',
    source: 'x = f"{value # first\n}" "# plain" f"{other # second\n}" # outside',
    comments: [' first', ' second', ' outside'],
  },
  {
    name: 'template interpolation and nested f-string',
    source: 'x = t"# literal {f"{value # nested\n}" # template\n}" # outside',
    comments: [' nested', ' template', ' outside'],
    minor: 14,
  },
  {
    name: 'raw template with nested template and dynamic format',
    source: 'x = rt"{t"{value # inner\n}" # outer\n!r:>{width # width\n}}"',
    comments: [' inner', ' outer', ' width'],
    minor: 14,
  },
];
