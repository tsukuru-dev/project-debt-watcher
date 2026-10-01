// Embedded so tsc includes these fixed helpers in the published dist/ output.
// Scanned text travels over stdin; it is never appended to the Python program.
export const pythonProbe = String.raw`
import sys, json
version = list(sys.version_info[:3])
compatible = version[0] == 3 and 12 <= version[1] <= 14
if compatible:
    import ast, io, tokenize
    sample = 'value = f"{1 # probe\n}"'
    ast.parse(sample)
    compatible = any(t.type == tokenize.COMMENT and t.string == '# probe'
                     for t in tokenize.generate_tokens(io.StringIO(sample).readline))
    if version[1] >= 14:
        sample = 'value = t"{1 # probe\n}"'
        ast.parse(sample)
        compatible = compatible and any(t.type == tokenize.COMMENT and t.string == '# probe'
                     for t in tokenize.generate_tokens(io.StringIO(sample).readline))
print(json.dumps({'protocol': 1, 'compatible': compatible, 'version': version}))
`;

export const pythonTokenize = String.raw`
import ast, codecs, io, json, sys, tokenize
version = list(sys.version_info[:3])
source = json.loads(sys.stdin.buffer.read().decode('utf-8'))
text = source.removeprefix('\ufeff').replace('\r\n', '\n').replace('\r', '\n')
result = {'protocol': 1, 'version': version}
try:
    encoding, _ = tokenize.detect_encoding(io.BytesIO(text.encode('utf-8')).readline)
    if codecs.lookup(encoding).name not in ('utf-8', 'utf-8-sig'):
        result.update(status='unsupported', message='Python source encoding is not UTF-8.', line=1, column=0)
    else:
        # tokenize documents valid syntax as a precondition. Parsing builds an AST;
        # it does not execute statements, import project modules or write bytecode.
        ast.parse(text, filename='<debt-watcher>', mode='exec')
        spans = []
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type == tokenize.ERRORTOKEN:
                raise tokenize.TokenError('Invalid Python token.', token.start)
            if token.type == tokenize.COMMENT:
                spans.append([token.start[0], token.start[1], token.end[1]])
        result.update(status='ok', spans=spans)
except SyntaxError as error:
    result.update(status='invalid', message=error.msg,
                  line=error.lineno or 1, column=max(0, (error.offset or 1) - 1))
except tokenize.TokenError as error:
    line, column = error.args[1]
    result.update(status='invalid', message=error.args[0], line=line, column=column)
except UnicodeError:
    result.update(status='invalid', message='Invalid Unicode in Python source.', line=1, column=0)
print(json.dumps(result, ensure_ascii=True))
`;
