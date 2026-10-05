// Fixed Go program compiled from our package, never from the repository being scanned.
// go/scanner may normalize CR in token literals and //line may change display
// positions, so spans come from token offsets and the original input bytes.
export const goHelper = String.raw`package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "go/scanner"
    "go/token"
    "io"
    "os"
    "runtime"
)

type request struct { Source string ` + "`json:\"source\"`" + String.raw` }
type reply struct {
    Protocol int ` + "`json:\"protocol\"`" + String.raw`
    Version string ` + "`json:\"version\"`" + String.raw`
    Status string ` + "`json:\"status\"`" + String.raw`
    Spans [][3]interface{} ` + "`json:\"spans\"`" + String.raw`
    Offset int ` + "`json:\"offset\"`" + String.raw`
    Message string ` + "`json:\"message,omitempty\"`" + String.raw`
}

func main() {
    out := reply{Protocol: 1, Version: runtime.Version(), Status: "ok", Spans: make([][3]interface{}, 0)}
    input, err := io.ReadAll(io.LimitReader(os.Stdin, (32<<20)+1))
    if err != nil || len(input) > 32<<20 { panic("invalid helper input") }
    var req request
    if err := json.Unmarshal(input, &req); err != nil { panic(err) }
    src := []byte(req.Source)
    files := token.NewFileSet()
    file := files.AddFile("<debt-finder>", -1, len(src))
    var lexer scanner.Scanner
    lexer.Init(file, src, func(pos token.Position, msg string) {
        if out.Status == "ok" {
            out.Status, out.Offset, out.Message = "invalid", pos.Offset, msg
        }
    }, scanner.ScanComments)
    for {
        pos, kind, _ := lexer.Scan()
        if kind == token.EOF { break }
        if kind != token.COMMENT { continue }
        start := file.Offset(pos)
        if start < 0 || start+2 > len(src) { panic("invalid comment offset") }
        if bytes.HasPrefix(src[start:], []byte("//")) {
            end := len(src)
            if at := bytes.IndexByte(src[start:], '\n'); at >= 0 { end = start+at }
            if end > start+2 && end < len(src) && src[end-1] == '\r' { end-- }
            out.Spans = append(out.Spans, [3]interface{}{"line", start, end})
        } else if bytes.HasPrefix(src[start:], []byte("/*")) {
            at := bytes.Index(src[start+2:], []byte("*/"))
            if at < 0 { continue } // go/scanner will report the malformed comment.
            out.Spans = append(out.Spans, [3]interface{}{"block", start, start+2+at+2})
        } else { panic(fmt.Sprintf("unexpected comment at %d", start)) }
    }
    if out.Status != "ok" { out.Spans = nil }
    if err := json.NewEncoder(os.Stdout).Encode(out); err != nil { panic(err) }
}
`;
