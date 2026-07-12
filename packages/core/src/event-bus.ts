export type EventHandler<Payload> = (payload: Payload) => void;

export class TypedEventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<EventHandler<Events[keyof Events]>>>();

  subscribe<Key extends keyof Events>(key: Key, handler: EventHandler<Events[Key]>): () => void {
    const current = this.handlers.get(key) ?? new Set<EventHandler<Events[keyof Events]>>();
    current.add(handler as EventHandler<Events[keyof Events]>);
    this.handlers.set(key, current);
    return () => this.unsubscribe(key, handler);
  }

  unsubscribe<Key extends keyof Events>(key: Key, handler: EventHandler<Events[Key]>): void {
    const current = this.handlers.get(key);
    current?.delete(handler as EventHandler<Events[keyof Events]>);
    if (current?.size === 0) this.handlers.delete(key);
  }

  publish<Key extends keyof Events>(key: Key, payload: Events[Key]): void {
    for (const handler of [...(this.handlers.get(key) ?? [])]) handler(payload);
  }

  once<Key extends keyof Events>(key: Key, handler: EventHandler<Events[Key]>): () => void {
    const unsubscribe = this.subscribe(key, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  clear(key?: keyof Events): void {
    if (key === undefined) this.handlers.clear();
    else this.handlers.delete(key);
  }
}
