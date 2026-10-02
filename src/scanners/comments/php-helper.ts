// Fixed PHP code. Scanned repository source is passed as JSON data on stdin.
export const phpHelper = String.raw`
$request = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($request) || !isset($request['source']) || !is_string($request['source'])) {
    throw new InvalidArgumentException('Missing source string');
}
$source = $request['source'];
$result = ['protocol' => 1, 'version' => PHP_VERSION];
try {
    $tokens = token_get_all($source, TOKEN_PARSE);
    $offset = 0;
    $spans = [];
    $inline = [];
    foreach ($tokens as $token) {
        $id = is_array($token) ? $token[0] : null;
        $text = is_array($token) ? $token[1] : $token;
        $end = $offset + strlen($text);
        if ($id === T_INLINE_HTML) {
            $inline[] = [$offset, $end];
        } elseif ($id === T_COMMENT || $id === T_DOC_COMMENT) {
            $line = str_starts_with($text, '//') || str_starts_with($text, '#');
            if ($line) {
                $commentEnd = $end;
                while ($commentEnd > $offset && ($source[$commentEnd - 1] === "\n" || $source[$commentEnd - 1] === "\r")) {
                    $commentEnd--;
                }
                $width = str_starts_with($text, '//') ? 2 : 1;
                $spans[] = ['line', $offset, $commentEnd, $offset + $width, $commentEnd];
            } else {
                $spans[] = ['block', $offset, $end, $offset + 2, $end - 2];
            }
        }
        $offset = $end;
    }
    if ($offset !== strlen($source)) throw new RuntimeException('Tokenizer did not cover source');
    $result['status'] = 'ok';
    $result['spans'] = $spans;
    $result['inline'] = $inline;
} catch (ParseError $error) {
    $result['status'] = 'invalid';
    $result['message'] = $error->getMessage();
}
fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR));
`;
