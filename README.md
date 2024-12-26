# ne-associations

In many cases, you might find yourself looking for an easy binding that
allows you to associate one bit of code with another without having to run
off and build a more complete solution. Associations can help with that.

## Getting Started

```js
const user = 'nyteshade'
const repo = 'ne-associations'
const script = '/src/associations.mjs'

const Associations = await import('https://cdn.jsdelivr.net/gh/${user}/${repo}${script}');
const { associate, associated, association } = Associations;

Object.assign(globalThis, {
  associate, associated, associtiaion,
  kAllKeys, kDefaultKey
});
```

## Basic usage
```js
let source = 42
let message = "The meaning of life"
associate(message, source)

console.log(`The message is: ${associated(42)}`)
```
