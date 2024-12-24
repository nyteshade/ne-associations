/**
 * A utility module for creating and managing weak associations between values
 * and objects. This system provides a powerful way to establish relationships
 * between data without creating memory leaks or preventing garbage collection.
 *
 * The Associations module solves several common problems in JavaScript
 * applications:
 *
 * 1. It allows you to attach metadata or related values to objects without
 *    modifying them directly, which is particularly useful when working with
 *    objects you don't own or shouldn't modify.
 *
 * 2. It maintains weak references to objects, meaning that if an object is no
 *    longer used elsewhere in your application, it can be garbage collected
 *    even if it has associations. This prevents memory leaks that would occur
 *    with traditional Map or WeakMap implementations.
 *
 * 3. It provides a flexible storage system that can be either global or scoped
 *    to specific objects, allowing you to manage associations at different
 *    levels of your application.
 *
 * Common use cases include:
 * - Caching computed values that should be garbage collected when the source
 *   object is no longer needed
 * - Implementing observer patterns where observers shouldn't prevent observed
 *   objects from being garbage collected
 * - Managing bidirectional relationships between objects without creating
 *   reference cycles
 * - Attaching temporary metadata to objects (like validation states or
 *   UI-related data)
 *
 * @module Associations
 */
export const Associations = (function () {
  // Symbol used for default associations when no subkey is provided
  const kDefaultKey = Symbol.for('association.key.default')

  // Symbol used to indicate that all subkeys should be targeted; primarily
  // used with disassociate().
  const kAllKeys = Symbol.for('association.key.allKeys')

  // Symbol used for storage map storage.
  const kStorageMapKey = Symbol.for('association.storage.map')

  /**
   * Internal class that handles wrapping of source values used as association
   * keys. For primitive sources, stores them directly without cleanup
   * capability. For objects, uses WeakRef to allow garbage collection and
   * automatic cleanup of associated values.
   *
   * The SourceWrapper class is a critical part of the association system's
   * memory management strategy. It handles two distinct cases:
   *
   * 1. Primitive sources (strings, numbers, etc.) are stored directly since
   *    they don't participate in garbage collection. Their associations must
   *    be manually cleaned up using disassociate().
   *
   * 2. Object sources are stored using WeakRef, allowing automatic cleanup of
   *    their associations when the source object is garbage collected.
   *
   * The class uses FinalizationRegistry for object sources to clean up
   * associated values when the source object is garbage collected, preventing
   * memory leaks in the association system itself.
   *
   * @private
   */
  class SourceWrapper {
    /**
     * Creates a new SourceWrapper instance, automatically detecting whether to use
     * weak references based on the source type.
     *
     * @param {*} source - The source value to wrap, can be any JavaScript value.
     *    When this is a primitive, associations must be manually cleaned up. When
     *    this is an object, associations will be automatically cleaned up when the
     *    object is garbage collected.
     */
    constructor(source) {
      this.isPrimitive = !(source && typeof source === 'object');
      this.associations = new Map();

      // future: wrap map.get/set in a HOF to allow ability to register
      // get and set listener hooks, filtered by key, for other systems
      // to react to.

      if (this.isPrimitive)
        this.value = source;

      else {
        this.ref = new WeakRef(source);
        this.registry = new FinalizationRegistry(() => {
          // When source object is collected, clear all its associations
          this.associations.clear();
          this.ref = undefined;
        });
        this.registry.register(source, Symbol('cleanup'));
      }
    }

    /**
     * Retrieves the wrapped source. For primitive sources, returns them
     * directly. For objects stored as weak references, attempts to dereference
     * them, returning undefined if the object has been garbage collected.
     *
     * @returns {*} The original source if primitive, or the dereferenced object
     * if non-primitive. Returns undefined if the referenced object has been
     * garbage collected.
     */
    get() {
      if (this.isPrimitive)
        return this.value

      return this.ref?.deref();
    }
  }

  /**
   * Internal function to create or retrieve the storage map for associations.
   * This function manages the creation and retrieval of storage maps, which are
   * attached to objects as non-enumerable properties to keep them hidden from
   * normal object iteration.
   *
   * The storage system is designed to be flexible:
   * - By default, it uses globalThis as the storage location
   * - Custom storage objects can be provided to scope associations
   * - Storage maps are created lazily only when needed
   * - Maps are stored as non-enumerable properties to avoid polluting object
   *    iteration
   *
   * @private
   * @param {Object} storage The object to store the map on
   * @param {boolean} create Whether to create the map if it doesn't exist
   * @returns {Map|undefined} The storage map or undefined if not found
   */
  function getStorageMap(storage = globalThis, create = true) {
    if (typeof storage !== 'object' || !(storage instanceof Object))
      throw new Error(`Cannot use '${String(storage)}' as storage carrier.`)

    if (storage[kStorageMapKey] || !create)
      return storage[kStorageMapKey]

    // Create new storage map if it doesn't exist
    const storageMap = new Map()

    // Store the map on the supplied storage object. This method prevents
    // pollution to the iteration map (i.e. dot completion and when viewing
    // in node REPLs and other such environments).
    //
    // Moreover, it negates the need to create and manage properties on the
    // supplied object. When that object is not globalThis|global|window, this
    // approach reduces overhead on the supplied object.
    Object.defineProperty(storage, kStorageMapKey, {
      value: storageMap,    // The value to store
      configurable: true,   // Allows replacing/removing the stored property
      enumerable: false,    // Prevents this property from being iterable
      writable: true        // Allows the overwriting of the property value
    })

    return storageMap
  }

  /**
   * This function removes any previously allocated storage map from the
   * supplied `storage` object upon which it is stored. This is an internal
   * method.
   *
   * @private
   * @param {Object} storage The object to store the map on
   * @returns {Map|undefined} the map to be removed if one exists, undefined
   * otherwise
   */
  function removeStorageMap(storage = globalThis) {
    if (typeof storage !== 'object' || !(storage instanceof Object))
      throw new Error(`Cannot use '${String(storage)}' as storage carrier.`)

    const mapToRemove = getStorageMap(storage, false)

    if (Reflect.has(storage, kStorageMapKey))
      delete storage[kStorageMapKey]

    return mapToRemove
  }

  /**
   * Associates a value with an object under an optional subkey. This function
   * is the primary way to create associations between values and objects. It
   * maintains weak references to objects, allowing them to be garbage
   * collected when no other references exist.
   *
   * Key features:
   * - Maintains weak references to prevent memory leaks
   * - Supports custom storage locations for scoped associations
   * - Allows subkeys for multiple associations with the same object
   * - Works with both primitive values and objects
   * - Preserves garbage collection for associated objects
   *
   * When to use:
   * - When you need to attach metadata to objects without modifying them
   * - For implementing caching systems that shouldn't prevent garbage
   *   collection
   * - When building object relationship systems that need to be memory-safe
   * - For temporary associations that shouldn't affect object lifecycle
   *
   * @param {*} value - The value to associate. Can be any JavaScript value,
   * including primitives and objects. Objects are stored as weak references.
   * @param {*} withObject - The object or value to associate the value with.
   * This becomes the key in the association map. It can be either a primitive
   * or an object, but note that values associated with a primitive must be
   * manually disassociated.
   * @param {string|number|symbol} subkey the identifier for associating extra
   * associations with `withObject` in question.
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.storage=globalThis] - Where to store the
   * association. Defaults to global storage, but can be any object to scope
   * the associations.
   * @param {string|symbol} [options.subkey=kDefaultKey] - Subkey for the
   * association, allowing multiple values to be associated with the same
   * object.
   * @returns {*} The original value
   *
   * @example
   * // Simple association with a primitive
   * const user = { id: 1 }
   * associate("John", user)
   *
   * @example
   * // Multiple associations using subkeys
   * const document = new Document()
   * associate(editor, document, 'currentEditor')
   * associate(permissions, document, 'accessRights')
   *
   * @example
   * // Scoped storage for component-level associations
   * class Component {
   *   constructor() {
   *     // Keep associations scoped to this component
   *     associate(metadata, targetObj, { storage: this })
   *   }
   * }
   */
  function associate(value, withSource, subkey, options = {}) {
    subkey = subkey ?? options?.subkey ?? kDefaultKey

    const { storage = globalThis } = options
    const storageMap = getStorageMap(storage)

    if (!storageMap)
      throw new Error(`No storage map within which to store associated values`)

    // Create or get the associations map for this object
    let wrapper = storageMap.get(withSource)

    if (!wrapper) {
      wrapper = new SourceWrapper(withSource)
      storageMap.set(withSource, wrapper)
    }

    if (subkey === kAllKeys) {
      for (const key of wrapper.associations.keys()) {
        wrapper.associations.set(key, value)
      }
    }

    else
      wrapper.associations.set(subkey, value)

    return value
  }

  /**
   * Retrieves a value associated with an object. This function provides flexible
   * ways to look up associations, including direct lookup, comparator-based
   * search, and default values.
   *
   * Key features:
   * - Supports direct lookup by object reference
   * - Allows custom comparison logic through comparator functions
   * - Provides default values for missing associations
   * - Handles garbage collected references gracefully
   *
   * The comparator function is particularly useful when:
   * - Working with objects that may be recreated but represent the same entity
   * - Implementing lookup by object properties rather than object identity
   * - Handling cases where the original object reference may not be available
   *
   * Memory safety:
   * - Returns undefined for garbage collected objects
   * - Doesn't prevent garbage collection of referenced objects
   * - Safely handles cases where associations have been cleaned up
   *
   * @param {*} withObject - The object to get the associated value from. This is
   *    the key in the association map.
   * @param {Object} [options={}] - Configuration options
   * @param {Object} [options.storage=globalThis] - Where the association is
   *    stored. Should match the storage used in associate().
   * @param {string|symbol} [options.subkey=kDefaultKey] - Subkey for the
   *    association, used to retrieve specific associations when multiple exist.
   * @param {*} [options.defaultValue=undefined] - Value to return if no
   *    association exists or if the associated object has been garbage collected.
   * @param {Function} [options.comparator=null] - Optional function to find
   *    matching object. Receives each stored object as an argument and should
   *    return true for a match.
   * @returns {*} The associated value, defaultValue if none exists, or undefined
   *    if the associated object has been garbage collected
   *
   * @example
   * // Simple retrieval
   * const user = { id: 1 }
   * associate("John", user)
   * const name = associated(user) // "John"
   *
   * @example
   * // Using a comparator for lookup by property
   * const users = [{ id: 1 }, { id: 2 }]
   * users.forEach(user => associate(user.id, user))
   *
   * // Find user with id 2
   * const user = associated({ id: 2 }, {
   *    comparator: obj => obj.id === 2
   * })
   *
   * @example
   * // Handling missing values with defaults
   * const config = associated(configObject, {
   *    defaultValue: { theme: 'light' }
   * })
   *
   * @example
   * // Component-scoped association lookup
   * class Component {
   *    getData() {
   *       return associated(this.target, {
   *          storage: this,
   *          subkey: 'metadata'
   *       })
   *    }
   * }
   */
  function associated(withObject, subkey, options = {}) {
    subkey = subkey ?? options?.subkey ?? kDefaultKey

    const {
      storage = globalThis,
      defaultValue = undefined,
      comparator = null
    } = options

    const storageMap = getStorageMap(storage, false)

    if (!storageMap)
      return defaultValue

    // If comparator is provided, search for matching object
    if (comparator) {
      for (const [obj, associations] of storageMap.entries()) {
        if (comparator(obj)) {
          const wrapper = associations.get(subkey);
          const value = wrapper?.get?.();

          if (value !== undefined)
            return value
        }
      }

      return defaultValue
    }

    // Direct lookup
    const objectAssociations = storageMap.get(withObject)

    if (!objectAssociations)
      return defaultValue

    return objectAssociations.associations.get(subkey) ?? defaultValue
  }

  /**
   * Removes associations for an object, either all or for a specific subkey.
   * This function provides a way to explicitly clean up associations when they're
   * no longer needed, rather than waiting for garbage collection.
   *
   * Key behaviors:
   * - Can remove a single association using a subkey
   * - Can remove the default association using constant `kDefaultKey`
   * - Can remove all associations for an object (`kAllKeys`)
   * - Safely handles non-existent associations
   * - Operates on global storage by default, but can be overridden using
   *   the `storage` property of any supplied options object. This must be
   *   an object or instanceof Object to function.
   *
   * When to use:
   * - During cleanup operations
   * - When implementing undo/redo functionality
   * - When an object's associations are no longer valid
   * - To free memory explicitly rather than waiting for garbage collection
   *
   * Note that disassociation isn't always necessary - if an object becomes
   * eligible for garbage collection, its associations will be automatically
   * cleaned up unless the recipient of an association is a primitive. These
   * tend to stay in allocation forever. Values associated with a primitive
   * must be disassociated when done or a memory leak will occur.
   *
   * Use this function when you need explicit control over when associations
   * are removed.
   *
   * @param {*} withObject - The object to remove associations from
   * @param {string|symbol} [subkey=kAllKeys] - Specific subkey to remove. If
   * `kAllKeys` is provided, the default, the all associations for the object
   * are removed.
   * @returns {boolean} True if an association was removed, false if no
   * matching association was found.
   *
   * @example
   * // Remove a specific association
   * const user = { id: 1 }
   * associate(metadata, user, { subkey: 'profile' })
   * disassociate(user, 'profile')
   *
   * @example
   * // Remove all associations
   * const document = new Document()
   * associate(editor, document, { subkey: 'editor' })
   * associate(permissions, document, { subkey: 'permissions' })
   * disassociate(document) // Removes all associations
   *
   * @example
   * // Cleanup during object disposal
   * class Component {
   *    dispose() {
   *       // Clean up all associations
   *       disassociate(this)
   *    }
   * }
   */
  function disassociate(withObject, subkey = kAllKeys, options = {}) {
    const storageObj = options?.storage ?? globalThis
    const storageMap = getStorageMap(storageObj, false)

    if (!storageMap)
      return false

    const objectAssociations = storageMap.get(withObject)

    if (!objectAssociations)
      return false

    // Remove specific subkey if provided and not null/undefined
    if (subkey !== kAllKeys)
      return objectAssociations.associations.delete(subkey)

    // Remove all associations
    return storageMap.delete(withObject)
  }

  /**
   * Creates a tuple of functions for managing associations with an object. This
   * provides a functional interface similar to React's useState, but for
   * associations.
   *
   * The returned tuple contains three functions:
   * 1. getter(defaultValue): Retrieves the current associated value, accepting
   *      an optional default value
   * 2. setter(newValue): Updates the association with a new value
   * 3. forget(): Removes the association entirely
   *
   * This pattern is particularly useful when:
   * - You need repeated access to and updates of an association
   * - You want to encapsulate association logic in a functional interface
   * - You're working in a functional programming style
   * - You want to pass association management capabilities to other functions
   *
   * The getter function accepts an optional default value parameter, making it
   * more flexible than direct use of associated(). The setter function handles
   * the storage and subkey details internally, providing a cleaner interface for
   * updates.
   *
   * Memory considerations:
   * - The returned functions maintain closure over the withObject and subkey
   * - These closures don't prevent garbage collection of the associated values
   * - The functions themselves should be discarded when no longer needed
   *
   * @param {*} withObject The object to create association functions for. This
   * is the target object for all operations.
   * @param {string|symbol} [subkey=kDefaultKey] - Subkey for the association,
   * allowing multiple association tuples for the same object.
   * @param {object|undefined} options an optional options object that will be
   * passed to calls to {@link associate}, {@link associated}, and
   * {@link disassociate}.
   * @returns {[Function, Function, Function]} A tuple containing a
   * `[getter, setter, forget]` set of functions
   *
   * @example
   * // Basic usage
   * const user = { id: 1 }
   * const [getName, setName, forgetName] = association(user)
   *
   * setName("John")
   * console.log(getName()) // "John"
   *
   * forgetName()
   * console.log(getName()) // undefined, since it has been forgotten
   * console.log(getName("Anonymous")) // "Anonymous" (using default value)
   *
   * @example
   * // Multiple associations with subkeys
   * const doc = new Document()
   * const [getEditor, setEditor] = association(doc, 'currentEditor')
   * const [getPermissions, setPermissions] = association(doc, 'permissions')
   *
   * setEditor(new Editor())
   * setPermissions({ canEdit: true })
   *
   * @example
   * // Using in a React-like component
   * class Component {
   *   constructor() {
   *     // Creates a getter and setter, that associates a value using storage
   *     // local to this component rather than globalStorage. It uses the
   *     // default key for getting and storing values
   *     const [getValue, setValue] = association(
   *       this,
   *       kDefaultKey,
   *       { storage: this }
   *     )
   *
   *     this.state = { getValue, setValue }
   *   }
   *
   *   updateValue(newValue) {
   *     this.state.setValue(newValue)
   *     this.render()
   *   }
   * }
   */
  function association(withObject, subkey = kDefaultKey, options) {
    if (
      !options ||
      (typeof options !== 'object' && !(options instanceof Object))
    ) {
      options = {}
    }

    const getter = (defaultValue) => associated(
      withObject,
      subkey,
      { defaultValue, ...options }
    );

    const setter = (value) => associate(value, withObject, subkey, options)
    const forget = () => disassociate(withObject, subkey, options)

    return [getter, setter, forget]
  }

  return Object.defineProperty({
    // functions
    association,
    associate,
    associated,
    disassociate,
    getStorageMap,

    // classes
    SourceWrapper,

    // constants
    kDefaultKey,
    kStorageMapKey,
  }, Symbol.toStringTag, {value: 'Associations', enumerable: false})
})()

export const {
  // functions
  association,
  associate,
  associated,
  disassociate,
  getStorageMap,
  removeStorageMap,

  // classes
  SourceWrapper,

  // constants
  kAllKeys,
  kDefaultKey,
  kStorageMapKey,
} = Associations