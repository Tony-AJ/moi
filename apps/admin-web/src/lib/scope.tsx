import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type EventSummary } from './api';

const SELECTED_KEY = 'moi:admin-event';

interface EventScope {
  events: EventSummary[];
  selectedEventId: string;
  selectedEvent: EventSummary | null;
  setSelectedEventId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const ScopeContext = createContext<EventScope | null>(null);

export function EventScopeProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEventId, setSelected] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.events();
      setEvents(list);
      setError(null);
      // Default to the newest event so every page has a scope on first load.
      setSelected((current) => {
        if (current && list.some((event) => event.id === current)) return current;
        return list[0]?.id ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setSelectedEventId = useCallback((id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<EventScope>(
    () => ({
      events,
      selectedEventId,
      selectedEvent: events.find((event) => event.id === selectedEventId) ?? null,
      setSelectedEventId,
      reload,
      loading,
      error,
    }),
    [events, selectedEventId, setSelectedEventId, reload, loading, error],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useEventScope(): EventScope {
  const context = useContext(ScopeContext);
  if (!context) throw new Error('useEventScope must be used inside EventScopeProvider');
  return context;
}

export function EventPicker({ allowAll = false }: { allowAll?: boolean }) {
  const { events, selectedEventId, setSelectedEventId } = useEventScope();

  return (
    <div className="grow">
      <label htmlFor="event-scope">Event</label>
      <select
        id="event-scope"
        value={selectedEventId}
        onChange={(changeEvent) => setSelectedEventId(changeEvent.target.value)}
      >
        {allowAll ? <option value="">All events</option> : null}
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
          </option>
        ))}
      </select>
    </div>
  );
}
