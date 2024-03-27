export const groupToMapBy = <K, V>(
  items: Iterable<V>,
  by: (item: V) => K
): ReadonlyMap<K, readonly V[]> =>
  [...items].reduce((map, item) => {
    const groupKey = by(item)
    const prev = map.get(groupKey) ?? []
    map.set(groupKey, [...prev, item])
    return map
  }, new Map<K, V[]>())
