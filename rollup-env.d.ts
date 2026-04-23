// rollup-plugin-serve 的 package.json exports 缺少 types 条件，
// 导致 moduleResolution: "bundler" 无法解析其类型，在此手动声明
declare module 'rollup-plugin-serve' {
  import type { Plugin } from 'rollup'
  import type { ServerOptions } from 'https'
  import type { Server } from 'http'

  interface RollupServeOptions {
    open?: boolean
    openPage?: string
    verbose?: boolean
    contentBase?: string | string[]
    historyApiFallback?: boolean | string
    host?: string
    port?: number | string
    https?: ServerOptions
    headers?: Record<string, string | string[]>
    mimeTypes?: Record<string, string[]>
    onListening?: (server: Server) => void
  }

  export default function serve(options?: RollupServeOptions | string): Plugin
}
