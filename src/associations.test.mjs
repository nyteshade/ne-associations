import { describe, test, expect, beforeEach } from 'vitest'
import {
  associate,
  associated,
  disassociate,
  association,
  kDefaultKey,
  kAllKeys,
  getStorageMap
} from './associations.mjs'

describe('Associations Module', () => {
  beforeEach(() => {
    // Clean up global storage before each test
    const storageMap = getStorageMap(globalThis, false)
    if (storageMap) {
      storageMap.clear()
    }
  })

  describe('Basic Association Operations', () => {
    test('should associate and retrieve a value with an object', () => {
      const obj = { id: 1 }
      const value = 'test value'

      associate(value, obj)
      expect(associated(obj)).toBe(value)
    })

    test('should handle multiple associations with different subkeys', () => {
      const obj = { id: 1 }
      const value1 = 'first value'
      const value2 = 'second value'

      associate(value1, obj, 'key1')
      associate(value2, obj, 'key2')

      expect(associated(obj, 'key1')).toBe(value1)
      expect(associated(obj, 'key2')).toBe(value2)
    })

    test('should return default value when no association exists', () => {
      const obj = { id: 1 }
      const defaultValue = 'default'

      expect(associated(obj, kDefaultKey, { defaultValue })).toBe(defaultValue)
    })
  })

  describe('Primitive Value Associations', () => {
    test('should associate values with primitive types', () => {
      const primitiveKey = 'test-key'
      const value = { data: 'test data' }

      associate(value, primitiveKey)
      expect(associated(primitiveKey)).toBe(value)
    })

    test('should handle multiple primitive keys', () => {
      const key1 = 'key1'
      const key2 = 'key2'
      const value1 = 'value1'
      const value2 = 'value2'

      associate(value1, key1)
      associate(value2, key2)

      expect(associated(key1)).toBe(value1)
      expect(associated(key2)).toBe(value2)
    })
  })

  describe('Custom Storage', () => {
    test('should use custom storage object', () => {
      const storage = {}
      const obj = { id: 1 }
      const value = 'test value'

      associate(value, obj, kDefaultKey, { storage })
      expect(associated(obj, kDefaultKey, { storage })).toBe(value)
      expect(associated(obj)).toBeUndefined() // Not in global storage
    })

    test('should maintain separate associations in different storage objects', () => {
      const storage1 = {}
      const storage2 = {}
      const obj = { id: 1 }
      const value1 = 'value1'
      const value2 = 'value2'

      associate(value1, obj, kDefaultKey, { storage: storage1 })
      associate(value2, obj, kDefaultKey, { storage: storage2 })

      expect(associated(obj, kDefaultKey, { storage: storage1 })).toBe(value1)
      expect(associated(obj, kDefaultKey, { storage: storage2 })).toBe(value2)
    })
  })

  describe('Disassociation', () => {
    test('should remove specific association', () => {
      const obj = { id: 1 }
      const value = 'test value'

      associate(value, obj)
      expect(disassociate(obj)).toBe(true)
      expect(associated(obj)).toBeUndefined()
    })

    test('should remove specific subkey association', () => {
      const obj = { id: 1 }
      const value1 = 'value1'
      const value2 = 'value2'

      associate(value1, obj, 'key1')
      associate(value2, obj, 'key2')

      expect(disassociate(obj, 'key1')).toBe(true)
      expect(associated(obj, 'key1')).toBeUndefined()
      expect(associated(obj, 'key2')).toBe(value2)
    })

    test('should return false when disassociating non-existent association', () => {
      const obj = { id: 1 }
      expect(disassociate(obj)).toBe(false)
    })
  })

  describe('Association Function Tuple', () => {
    test('should create working getter/setter/forget tuple', () => {
      const obj = { id: 1 }
      const [getValue, setValue, forget] = association(obj)
      const value = 'test value'

      setValue(value)
      expect(getValue()).toBe(value)

      forget()
      expect(getValue()).toBeUndefined()
    })

    test('should handle default values in getter', () => {
      const obj = { id: 1 }
      const [getValue] = association(obj)
      const defaultValue = 'default'

      expect(getValue(defaultValue)).toBe(defaultValue)
    })

    test('should maintain separate tuples for different subkeys', () => {
      const obj = { id: 1 }
      const [getValue1, setValue1] = association(obj, 'key1')
      const [getValue2, setValue2] = association(obj, 'key2')

      setValue1('value1')
      setValue2('value2')

      expect(getValue1()).toBe('value1')
      expect(getValue2()).toBe('value2')
    })
  })

  describe('Comparator Functionality', () => {
    test('should find association using comparator', () => {
      const obj1 = { id: 1, name: 'test' }
      const obj2 = { id: 2, name: 'test2' }
      const value = 'found value'

      associate(value, obj1)

      const found = associated({ id: 1 }, kDefaultKey, {
        comparator: (obj) => obj.id === 1
      })

      expect(found).toBe(value)
    })

    test('should return default value when comparator finds no match', () => {
      const obj = { id: 1 }
      const value = 'test value'
      const defaultValue = 'default'

      associate(value, obj)

      const result = associated({ id: 2 }, kDefaultKey, {
        comparator: (obj) => obj.id === 2,
        defaultValue
      })

      expect(result).toBe(defaultValue)
    })
  })

  describe('Edge Cases', () => {
    test('should handle undefined and null values', () => {
      const obj = { id: 1 }

      associate(undefined, obj, 'undefined')
      associate(null, obj, 'null')

      expect(associated(obj, 'undefined')).toBeUndefined()
      expect(associated(obj, 'null')).toBeNull()
    })

    test('should handle symbol subkeys', () => {
      const obj = { id: 1 }
      const symbolKey = Symbol('test')
      const value = 'symbol value'

      associate(value, obj, symbolKey)
      expect(associated(obj, symbolKey)).toBe(value)
    })
  })

  describe('Memory Management', () => {
    test('should use WeakRef for object sources', () => {
      const obj = { id: 1 }
      const value = 'test value'

      associate(value, obj)

      // Get the internal storage map
      const storageMap = getStorageMap(globalThis)
      const wrapper = storageMap.get(obj)

      expect(wrapper.ref).toBeDefined()
      expect(wrapper.isPrimitive).toBe(false)
    })

    test('should not use WeakRef for primitive sources', () => {
      const primitiveKey = 'test-key'
      const value = 'test value'

      associate(value, primitiveKey)

      const storageMap = getStorageMap(globalThis)
      const wrapper = storageMap.get(primitiveKey)

      expect(wrapper.value).toBe(primitiveKey)
      expect(wrapper.isPrimitive).toBe(true)
    })
  })
})