// Fixed standard-library helper. The repository's source is data, never Ruby code to execute.
export const rubyHelper = String.raw`
require 'json'
require 'ripper'
request = JSON.parse(STDIN.read)
version = RUBY_VERSION
probe = request['probe'] == true
source = probe ? "x = \"é\" # line\n=begin\nbody\n=end\nx = \"\#{1 # inner\n}\"\n" : request.fetch('source')
result = {protocol: 1, version: version}
begin
  starts = [0]
  source.each_line { |line| starts << starts[-1] + line.bytesize }
  comments = []
  block = nil
  Ripper.lex(source, '<debt-finder>', 1, raise_errors: true).each do |position, event, text, state|
    offset = starts.fetch(position[0] - 1) + position[1]
    finish = offset + text.bytesize
    case event
    when :on_comment
      finish -= 1 if text.end_with?("\n")
      finish -= 1 if source.byteslice(finish - 1, 1) == "\r"
      comments << ['line', offset, finish, offset + 1, finish]
    when :on_embdoc_beg
      block = [offset, finish]
    when :on_embdoc_end
      raise 'Unmatched block comment token' unless block
      finish -= 1 if text.end_with?("\n")
      finish -= 1 if source.byteslice(finish - 1, 1) == "\r"
      comments << ['block', block[0], finish, block[1], offset]
      block = nil
    end
  end
  raise SyntaxError, 'Unterminated block comment' if block
  comments.sort_by! { |entry| entry[1] }
  result.merge!(status: 'ok', spans: comments)
  if probe
    bodies = comments.map { |entry| source.byteslice(entry[3]...entry[4]) }
    result[:compatible] = bodies == [' line', "body\n", ' inner']
  end
rescue SyntaxError, ArgumentError => error
  result.merge!(status: 'invalid', message: error.message)
  result[:compatible] = false if probe
end
STDOUT.write(JSON.generate(result))
`;
