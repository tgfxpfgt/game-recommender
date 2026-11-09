// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
/// <reference types="extension/types" />

// Polyfill types for browser.* APIs
/// <reference types="extension/types/polyfill" />

// Asset and stylesheet imports: the extension package does not resolve
// from this project, so the declares it ships are written here instead.
declare module '*.css' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.scss' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.sass' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.less' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.module.css' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.module.scss' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.module.sass' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.module.less' {
  const content: Readonly<Record<string, string>>
  export default content
}
declare module '*.png' {
  const content: string
  export default content
}
declare module '*.jpg' {
  const content: string
  export default content
}
declare module '*.jpeg' {
  const content: string
  export default content
}
declare module '*.gif' {
  const content: string
  export default content
}
declare module '*.webp' {
  const content: string
  export default content
}
declare module '*.avif' {
  const content: string
  export default content
}
declare module '*.ico' {
  const content: string
  export default content
}
declare module '*.bmp' {
  const content: string
  export default content
}
declare module '*.svg' {
  const content: any
  export default content
}
declare module '*?raw' {
  const content: string
  export default content
}
declare module '*?url' {
  const content: string
  export default content
}
