import { Compiler } from "builtin:c";
const root = import.meta.url.substr(8).split('/').slice(0, -2).join('\\');
const compiler = new Compiler("memory");
compiler.include(root + "\\vendor\\miniz");
compiler.compile(`
#include <miniz.c>
#include <tjs.h>

int do_inflate(tjsvec_buf out, tjsvec_buf in) {
  z_stream scoped(mz_inflateEnd) stream;
  int status;
  memset(&stream, 0, sizeof(stream));

  stream.next_in = in.ptr;
  stream.avail_in = (mz_uint32)in.len;
  stream.next_out = out.ptr;
  stream.avail_out = (mz_uint32)out.len;
  status = mz_inflateInit(&stream);
  if (status != MZ_OK)
    return 0;
  status = mz_inflate(&stream, MZ_FINISH);
  if (status != MZ_STREAM_END) return 0;
  return stream.next_in - in.ptr;
}
`);
const api = compiler.relocate({ do_inflate: "vv!i" as const });
export const inflate = api.do_inflate.bind(api);