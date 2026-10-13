import { useState, useEffect } from 'react';
import { api, checkHealth, createDsn, getDsn, listFeatureFlags, evaluateFeatureFlags } from '../lib/api';

export function APIDemo() {
  const [health, setHealth] = useState<{ status: string; eventsStored: number } | null>(null);
  const [dsn, setDsn] = useState<{ dsn: string; projectId: string } | null>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await checkHealth();
      if (result.data) {
        setHealth(result.data);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const runCreateDsn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createDsn({ 
        projectId: 'demo-project', 
        host: 'benemetrics.app' 
      });
      if (result.data) {
        setDsn(result.data);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const runListFlags = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFeatureFlags();
      if (result.data) {
        setFlags(result.data.data || []);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const runEvaluateFlags = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await evaluateFeatureFlags({
        user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
        flags: ['new-dashboard', 'experimental-feature'],
        context: { platform: 'web', version: '1.0.0' }
      });
      console.log('Evaluation result:', result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Direct Eden Treaty usage example
  const runDirectTreaty = async () => {
    setLoading(true);
    setError(null);
    try {
      // Direct access to any endpoint with full type safety
      const response = await api.api.dsn.create.post({
        projectId: 'direct-treaty-test',
        host: 'benemetrics.app'
      });
      console.log('Direct treaty response:', response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

   const directTreatyCode = "api.api.dsn.create.post({ projectId: 'direct-treaty-test', host: 'benemetrics.app' })";

   return (
    <div className="p-4 space-y-4">
      <h2 className="text-headline-sm text-on-surface font-semibold">Eden Treaty API Demo</h2>
      
      <div className="bg-surface-container-low p-4 rounded-xl space-y-3">
        <h3 className="text-code-sm text-primary font-semibold">Health Check</h3>
        <button 
          onClick={runHealthCheck} 
          disabled={loading}
          className="px-3 py-1.5 bg-primary text-on-primary rounded-lg text-code-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Check Health'}
        </button>
        {health && (
          <pre className="bg-surface-container-lowest p-2 rounded text-code-sm text-on-surface overflow-x-auto">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl space-y-3">
        <h3 className="text-code-sm text-primary font-semibold">Create DSN</h3>
        <button 
          onClick={runCreateDsn} 
          disabled={loading}
          className="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-code-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create DSN'}
        </button>
        {dsn && (
          <pre className="bg-surface-container-lowest p-2 rounded text-code-sm text-on-surface overflow-x-auto">
            {JSON.stringify(dsn, null, 2)}
          </pre>
        )}
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl space-y-3">
        <h3 className="text-code-sm text-primary font-semibold">List Feature Flags (Admin)</h3>
        <button 
          onClick={runListFlags} 
          disabled={loading}
          className="px-3 py-1.5 bg-tertiary text-on-tertiary rounded-lg text-code-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'List Flags'}
        </button>
        {flags.length > 0 && (
          <pre className="bg-surface-container-lowest p-2 rounded text-code-sm text-on-surface overflow-x-auto">
            {JSON.stringify(flags, null, 2)}
          </pre>
        )}
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl space-y-3">
        <h3 className="text-code-sm text-primary font-semibold">Evaluate Feature Flags (Client)</h3>
        <button 
          onClick={runEvaluateFlags} 
          disabled={loading}
          className="px-3 py-1.5 bg-error text-on-error rounded-lg text-code-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Evaluating...' : 'Evaluate Flags'}
        </button>
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl space-y-3">
        <h3 className="text-code-sm text-primary font-semibold">Direct Eden Treaty Usage</h3>
        <button 
          onClick={runDirectTreaty} 
          disabled={loading}
          className="px-3 py-1.5 bg-surface-container-high text-on-surface rounded-lg text-code-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Call api.api.dsn.create.post()'}
        </button>
         <p className="text-code-sm text-on-surface-variant">
           Full type-safe access: <code className="bg-surface-container-lowest px-1 py-0.5 rounded">{directTreatyCode}</code>
        </p>
      </div>

      {error && (
        <div className="bg-error-container text-on-error-container p-3 rounded-lg text-code-sm">
          Error: {error}
        </div>
      )}
    </div>
  );
}