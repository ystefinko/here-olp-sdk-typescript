/*
 * Copyright (C) 2019 HERE Europe B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 * License-Filename: LICENSE
 */

/**
 * @todo Assert function should be removed to common module when it will be created
 */
const isProduction = process.env.NODE_ENV === "production";

function assert(condition: boolean, message?: string): void {
    if (!isProduction && !condition) {
        throw new Error(message !== undefined ? message : "ASSERTION failed");
    }
}

/** @hidden */
export class Entry<Key, Value> {
    constructor(
        public key: Key,
        public value: Value,
        public size: number,
        public newer: Entry<Key, Value> | null,
        public older: Entry<Key, Value> | null
    ) {}
}

/**
 * Fixed size cache that evicts its entries in least-recently-used order when it overflows.
 * Modeled after standard JavaScript `Map` otherwise.
 */
export class LRUCache<Key, Value> {
    /**
     * Optional callback that is called on every item that is evicted from the cache.
     *
     * **Note**: This callback is not called when an item is explicitly deleted from the map via
     * [[delete]] or [[clear]].
     */
    evictionCallback?: (key: Key, value: Value) => void;

    /**
     * Optional callback that is called on every item that should be evicted from the cache to
     * determine if it can be removed, or should be locked in the cache.
     *
     * It returns `true` if the item can be removed from cache, `false` otherwise. Locking items in
     * the cache should be a temporary measure, since if the cache is filled with non-evictable
     * items only, it may grow beyond its capacity.
     *
     * **Note**: This callback is not called when an item is explicitly deleted from the map via
     * [[delete]] or [[clear]].
     */
    canEvict?: (key: Key, value: Value) => boolean;
    private m_capacity: number;
    private m_size = 0;

    /**
     * The internal map object that keeps the key-value pairs and their order.
     */
    private m_map = new Map<Key, Entry<Key, Value>>();

    /**
     * The newest entry, i.e. the most recently used item.
     */
    private m_newest: Entry<Key, Value> | null = null;

    /**
     * The oldest entry, i.e. the least recently used item.
     */
    private m_oldest: Entry<Key, Value> | null = null;

    /**
     * A function determining the size per element.
     */
    private m_sizeFunction: (v: Value) => number;

    /**
     * Creates a new instance of `LRUCache`. The optional sizeFunction can be used
     * fine tune the size required to cache that item.
     *
     * @param cacheCapacity The maximum number of entries to store in the cache.
     * @param sizeFunction A function determining the size per element.
     */
    constructor(
        cacheCapacity: number,
        sizeFunction: (v: Value) => number = () => 1
    ) {
        this.m_capacity = cacheCapacity;
        this.m_sizeFunction = sizeFunction;
    }

    /**
     * Iterates over all items from the most recently used item to the least recently used one.
     *
     * **Note**: Results are undefined if the cache is modified during iteration.
     *
     * @param callbackfn The callback to call for each item.
     * @param thisArg Optional this argument for the callback.
     */
    forEach(
        callbackfn: (value: Value, key: Key, map: LRUCache<Key, Value>) => void,
        thisArg?: any
    ): void {
        let entry = this.m_newest;
        while (entry !== null) {
            callbackfn.call(thisArg, entry.value, entry.key, this);
            entry = entry.older;
        }
    }

    /**
     * The size of the cache, i.e. the sum of all the sizes of all the objects in the cache.
     *
     * @returns The size of the cache.
     */
    get size(): number {
        return this.m_size;
    }

    /**
     * Returns the maximum capacity of the cache, i.e. the maximum number of elements this cache can
     * contain.
     *
     * @returns The capacity of the cache.
     */
    get capacity(): number {
        return this.m_capacity;
    }

    /**
     * @deprecated - DO NOT USE. Will be removed in future versions.
     *
     * Returns the internal map object that keeps the key-value pairs and their order.
     *
     * @returns The internal map object.
     */
    get map(): Map<Key, Entry<Key, Value>> {
        // ### TODO - remove me. Cache must not expose its internal object,
        // modifications to it are fatal for the internal state machine.
        return this.m_map;
    }

    /**
     * Returns the newest entry in the cache.
     *
     * @returns Newest entry in the cache.
     */
    get newest(): Entry<Key, Value> | null {
        return this.m_newest;
    }

    /**
     * Returns the oldest entry in the cache.
     *
     * Note: Does not promote the oldest item as most recently used item.
     *
     * @returns Oldest entry in the cache.
     */
    get oldest(): Entry<Key, Value> | null {
        return this.m_oldest;
    }

    /**
     * Resets the capacity of this cache. If `newCapacity` is smaller than the current cache size,
     * all items will be evicted until the cache shrinks to `newCapacity`.
     *
     * @param newCapacity The new capacity of this cache.
     */
    setCapacity(newCapacity: number): void {
        this.m_capacity = newCapacity;
        this.evict();
    }

    /**
     * Updates the size of all elements in this cache. If their aggregated size is larger than the
     * capacity, items will be evicted until the cache shrinks to fit the capacity.
     */
    shrinkToCapacity(): void {
        let size = 0;
        const sizeFunction = this.m_sizeFunction;

        let entry = this.m_newest;
        while (entry !== null) {
            const entrySize = sizeFunction(entry.value);
            entry.size = entrySize;
            size += entrySize;
            entry = entry.older;
        }

        this.m_size = size;
        this.evict();
    }

    /**
     * Inserts or updates a key/value pair in the cache.
     *
     * If the key already existed in the cache, it will be updated and promoted to the most recently
     * used item.
     *
     * If the key didn't exist in the cache, it will be inserted as most recently used item. An
     * eviction of the least recently used item takes place if the cache exceeded its capacity.
     *
     * @param key The key for the key-value pair to insert or update.
     * @param value The value for the key-value pair to insert or update.
     */
    set(key: Key, value: Value) {
        const valueSize = this.m_sizeFunction(value);
        let entry = this.m_map.get(key);
        if (entry !== undefined) {
            this.m_size = this.m_size - entry.size + valueSize;
            entry.value = value;
            entry.size = valueSize;
            this.promote(entry);
            this.evict();
        } else {
            if (valueSize > this.m_capacity) {
                return; // single item too big to cache
            }

            entry = new Entry<Key, Value>(key, value, valueSize, null, null);
            if (this.m_map.size === 0) {
                this.m_newest = this.m_oldest = entry;
            } else {
                assert(this.m_newest !== null);
                const newest: Entry<Key, Value> = this.m_newest!;
                entry.older = this.m_newest;
                newest.newer = entry;
                this.m_newest = entry;
            }
            this.m_map.set(key, entry);
            this.m_size += valueSize;
            this.evict();
        }
    }

    /**
     * Looks up key in the cache and returns the associated value.
     *
     * @param key The key to look up.
     * @returns The associated value, or `undefined` if the key-value pair is not in the cache.
     */
    get(key: Key): Value | undefined {
        const entry = this.m_map.get(key);
        if (entry === undefined) {
            return undefined;
        }

        this.promote(entry);
        return entry.value;
    }

    /**
     * Test if a key/value pair is in the cache.
     *
     * @param key The key to look up.
     * @returns `true` if the key-value pair is in the cache, `false` otherwise.
     */
    has(key: Key): boolean {
        return this.m_map.has(key);
    }

    /**
     * Clears the cache and removes all stored key-value pairs.
     *
     * Does not call the eviction callback. Use [[evictAll]] to clear the cache and call the
     * eviction callback.
     */
    clear(): void {
        this.m_newest = this.m_oldest = null;
        this.m_size = 0;
        this.m_map.clear();
    }

    /**
     * Evicts all items from the cache, calling the eviction callback on each item.
     *
     * Use [[clear]] to remove all items without calling the eviction callback.
     */
    evictAll(): void {
        const cb = this.evictionCallback;
        if (cb !== undefined) {
            this.forEach((value, key) => {
                cb(key, value);
            });
        }
        this.clear();
    }

    /**
     * Explicitly removes a key-value pair from the cache.
     *
     * **Note**: This is an explicit removal, thus, the eviction callback will not be called.
     *
     * @param key The key of the key-value pair to delete.
     * @returns `true` if the key-value pair existed and was deleted, `false` otherwise.
     */
    delete(key: Key): boolean {
        const entry = this.m_map.get(key);
        if (entry === undefined) {
            return false;
        }

        if (entry === this.m_newest) {
            this.m_newest = entry.older;
        } else if (entry.newer) {
            entry.newer.older = entry.older;
        } else {
            assert(false);
        }

        if (entry === this.m_oldest) {
            this.m_oldest = entry.newer;
        } else if (entry.older) {
            entry.older.newer = entry.newer;
        } else {
            assert(false);
        }

        this.m_size -= entry.size;
        return this.m_map.delete(key);
    }

    protected evict() {
        while (this.m_oldest !== null && this.m_size > this.m_capacity) {
            const evicted = this.evictOldest();
            if (evicted === undefined) {
                return;
            }
        }
    }

    protected evictOldest(): Entry<Key, Value> | undefined {
        assert(this.m_oldest !== null);
        const oldest = this.m_oldest!;
        assert(oldest.older === null);
        let itemToRemove = oldest;

        if (this.canEvict !== undefined) {
            while (!this.canEvict(itemToRemove.key, itemToRemove.value)) {
                if (itemToRemove.newer === null) {
                    return undefined;
                }
                itemToRemove = itemToRemove.newer;
            }
        }

        if (itemToRemove === oldest) {
            this.m_oldest = itemToRemove.newer;
            if (itemToRemove.newer !== null) {
                assert(itemToRemove.newer.older === itemToRemove);
                itemToRemove.newer.older = null;
            }
        } else {
            if (itemToRemove.newer !== null) {
                assert(itemToRemove.newer.older === itemToRemove);
                itemToRemove.newer.older = itemToRemove.older;
                if (itemToRemove.older !== null) {
                    itemToRemove.older.newer = itemToRemove.newer;
                }
            } else {
                return undefined;
            }
        }

        const isOk = this.m_map.delete(itemToRemove.key);
        assert(isOk === true);
        if (isOk && this.evictionCallback !== undefined) {
            this.evictionCallback(itemToRemove.key, itemToRemove.value);
        }
        this.m_size -= itemToRemove.size;
        return itemToRemove;
    }

    private promote(entry: Entry<Key, Value>): void {
        if (entry === this.m_newest) {
            return;
        } // already newest, nothing to do

        // re-link newer and older items
        if (entry.newer) {
            assert(entry.newer.older === entry);
            entry.newer.older = entry.older;
        }
        if (entry.older) {
            assert(entry.older.newer === entry);
            entry.older.newer = entry.newer;
        }
        if (entry === this.m_oldest) {
            this.m_oldest = entry.newer;
        }
        // re-link ourselves
        entry.newer = null;
        entry.older = this.m_newest;

        // finally, set ourselves as the newest entry
        assert(this.m_newest !== null);
        const newest = this.m_newest!;
        assert(newest.newer === null);
        newest.newer = entry;
        this.m_newest = entry;
    }
}
