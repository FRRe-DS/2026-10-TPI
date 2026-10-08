import React, { useState, useEffect } from 'react';
import {
  Bell,
  QrCode,
  LifeBuoy,
  Send,
  CheckCircle,
  AlertTriangle,
  PlayCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

const API_BASE = 'http://localhost:3000/api/v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'tickets' | 'notifications' | 'qr' | 'simulator'>('overview');
  const [healthStatus, setHealthStatus] = useState<any>(null);

  const [tickets, setTickets] = useState<any[]>([
    {
      id: '1',
      ticketNumber: 'TCK-1001',
      referenceId: 'trip-9082',
      referenceType: 'TRIP',
      subject: 'Cobro duplicado de tarifa de peaje',
      status: 'OPEN',
      priority: 'HIGH',
      createdBy: 'pasajero@movilidad.com',
      createdAt: new Date().toISOString(),
    },
    {
      id: '2',
      ticketNumber: 'TCK-1002',
      referenceId: 'res-5021',
      referenceType: 'RESERVATION',
      subject: 'Consulta por cambio de horario de reserva',
      status: 'RESOLVED',
      priority: 'LOW',
      createdBy: 'usuario2@movilidad.com',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ]);
  const [newTicket, setNewTicket] = useState({
    referenceId: '',
    referenceType: 'TRIP',
    subject: '',
    description: '',
    createdBy: 'operador@movilidad.com',
  });

  const [notifications, setNotifications] = useState<any[]>([
    {
      id: 'notif-1',
      channel: 'EMAIL',
      recipient: 'cliente@ejemplo.com',
      subject: 'Tu conductor asignado ha llegado',
      status: 'SENT',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'notif-2',
      channel: 'EMAIL',
      recipient: 'juan.perez@ejemplo.com',
      subject: 'Comprobante de Viaje #trip-9082',
      status: 'SENT',
      createdAt: new Date(Date.now() - 1800000).toISOString(),
    },
  ]);

  const [qrTripId, setQrTripId] = useState('trip-demo-4482');
  const [generatedQr, setGeneratedQr] = useState<any>(null);
  const [verifyToken, setVerifyToken] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const [simulationLog, setSimulationLog] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setHealthStatus(data))
      .catch(() => setHealthStatus({ status: 'offline' }));
  }, []);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket),
      });
      if (res.ok) {
        const created = await res.json();
        setTickets([created, ...tickets]);
        setNewTicket({ referenceId: '', referenceType: 'TRIP', subject: '', description: '', createdBy: 'operador@movilidad.com' });
      } else {
        alert('Error creando ticket en el backend');
      }
    } catch {
      const mockTicket = {
        id: String(Date.now()),
        ticketNumber: `TCK-${1000 + tickets.length + 1}`,
        ...newTicket,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      };
      setTickets([mockTicket, ...tickets]);
      setNewTicket({ referenceId: '', referenceType: 'TRIP', subject: '', description: '', createdBy: 'operador@movilidad.com' });
    }
  };

  const handleGenerateQr = async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/qr/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId: qrTripId, passengerId: 'usr-123', ttlSeconds: 300 }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedQr(data);
        setVerifyToken(data.token);
      }
    } catch {
      setGeneratedQr({
        token: `qr_${qrTripId}_mock123`,
        tripId: qrTripId,
        qrDataUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="black"/><text x="50%" y="50%" fill="white" font-size="12" text-anchor="middle">QR SIMULADO</text></svg>',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        ttlSeconds: 300,
      });
      setVerifyToken(`qr_${qrTripId}_mock123`);
    }
  };

  const handleVerifyQr = async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/qr/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken, tripId: qrTripId }),
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch {
      setVerifyResult({ valid: true, message: 'QR validado correctamente en modo local' });
    }
  };

  const handleSimulateTrip = async () => {
    const tripId = `trip-${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      await fetch(`${API_BASE}/simulator/trip-completed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          passengerEmail: 'cliente.viaje@ejemplo.com',
          driverName: 'Roberto Gómez',
          fare: 3850,
        }),
      });
    } catch { }

    const logEntry = `[${new Date().toLocaleTimeString()}] Evento 'trip.completed' disparado para #${tripId} -> Notificación enviada & Comprobante generado`;
    setSimulationLog((prev) => [logEntry, ...prev]);

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        channel: 'EMAIL',
        recipient: 'cliente.viaje@ejemplo.com',
        subject: `¡Viaje Finalizado! Comprobante #${tripId}`,
        status: 'SENT',
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-logo">M8</div>
          <div className="brand-text">
            <h1>Módulo 8</h1>
            <p>Grupo 10 · Software 2026</p>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            id="nav-overview"
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <ShieldCheck size={18} />
            Resumen General
          </button>
          <button
            id="nav-tickets"
            className={`nav-item ${activeTab === 'tickets' ? 'active' : ''}`}
            onClick={() => setActiveTab('tickets')}
          >
            <LifeBuoy size={18} />
            Soporte & Tickets (RF-8.7)
          </button>
          <button
            id="nav-notifications"
            className={`nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <Bell size={18} />
            Notificaciones (RF-8.6)
          </button>
          <button
            id="nav-qr"
            className={`nav-item ${activeTab === 'qr' ? 'active' : ''}`}
            onClick={() => setActiveTab('qr')}
          >
            <QrCode size={18} />
            Verificación QR (RF-8.3)
          </button>
          <button
            id="nav-simulator"
            className={`nav-item ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            <PlayCircle size={18} />
            Simulador de Eventos
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">
            <span
              className="status-dot"
              style={{
                backgroundColor: healthStatus?.status === 'ok' ? '#10b981' : '#f59e0b',
                boxShadow: `0 0 8px ${healthStatus?.status === 'ok' ? '#10b981' : '#f59e0b'}`,
              }}
            />
            {healthStatus?.status === 'ok' ? 'API M8 Conectada' : 'Modo Demostración'}
          </div>
          <a
            href="http://localhost:3000/api/docs"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '6px 12px', textDecoration: 'none' }}
          >
            <ExternalLink size={14} /> Swagger OpenAPI
          </a>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <h2 className="page-title">
            {activeTab === 'overview' && 'Panel de Control - Módulo 8'}
            {activeTab === 'tickets' && 'Gestión de Tickets y Soporte'}
            {activeTab === 'notifications' && 'Historial de Notificaciones y Entregas'}
            {activeTab === 'qr' && 'Generador y Escáner de Códigos QR'}
            {activeTab === 'simulator' && 'Emulador de Eventos Asíncronos'}
          </h2>
          <div className="top-bar-actions">
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>Plataforma de Movilidad Urbana</span>
          </div>
        </header>

        <div className="content-body">
          {activeTab === 'overview' && (
            <>
              <div className="stats-grid">
                <div className="glass-card stat-item">
                  <span className="stat-label">Tickets Activos</span>
                  <span className="stat-value" style={{ color: '#6366f1' }}>{tickets.length}</span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Notificaciones Enviadas</span>
                  <span className="stat-value" style={{ color: '#10b981' }}>{notifications.length}</span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Tasa de Entrega</span>
                  <span className="stat-value" style={{ color: '#38bdf8' }}>100%</span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Seguridad QR</span>
                  <span className="stat-value" style={{ color: '#d946ef' }}>TTL 300s</span>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Arquitectura del Módulo 8 (Grupo 10)</h3>
                <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.6' }}>
                  Este módulo opera como un microservicio independiente con <strong>Arquitectura Hexagonal</strong>, cumpliendo con la propiedad de datos (RNF-05), persistencia con PostgreSQL + Prisma ORM (compatible con Supabase), estado efímero en Redis para tokens de QR (RF-8.3), y consumo asíncrono desacoplado con RabbitMQ (RF-8.8).
                </p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '18px' }}>
                  <button className="btn btn-primary" onClick={() => setActiveTab('simulator')}>
                    <PlayCircle size={16} /> Probar Simulación en Vivo
                  </button>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('tickets')}>
                    <LifeBuoy size={16} /> Ver Tickets de Soporte
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'tickets' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px' }}>
              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Listado de Tickets (RF-8.7)</h3>
                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Ref</th>
                        <th>Asunto</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t) => (
                        <tr key={t.id}>
                          <td style={{ fontWeight: 600 }}>{t.ticketNumber}</td>
                          <td>
                            <span className="badge badge-info">{t.referenceType}: {t.referenceId}</span>
                          </td>
                          <td>{t.subject}</td>
                          <td>
                            <span className={`badge ${t.status === 'RESOLVED' ? 'badge-success' : 'badge-warning'}`}>
                              {t.status}
                            </span>
                          </td>
                          <td style={{ color: '#9ca3af', fontSize: '12px' }}>
                            {new Date(t.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Nuevo Ticket</h3>
                <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">ID de Referencia</label>
                    <input
                      id="input-ticket-ref"
                      className="form-input"
                      placeholder="Ej. trip-9821"
                      required
                      value={newTicket.referenceId}
                      onChange={(e) => setNewTicket({ ...newTicket, referenceId: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo</label>
                    <select
                      className="form-select"
                      value={newTicket.referenceType}
                      onChange={(e) => setNewTicket({ ...newTicket, referenceType: e.target.value })}
                    >
                      <option value="TRIP">Viaje (TRIP)</option>
                      <option value="RESERVATION">Reserva (RESERVATION)</option>
                      <option value="PAYMENT">Pago (PAYMENT)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Asunto</label>
                    <input
                      id="input-ticket-subject"
                      className="form-input"
                      placeholder="Resumen del problema"
                      required
                      value={newTicket.subject}
                      onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Descripción</label>
                    <textarea
                      id="input-ticket-desc"
                      className="form-textarea"
                      rows={3}
                      placeholder="Detalle del reclamo..."
                      required
                      value={newTicket.description}
                      onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                    />
                  </div>
                  <button id="btn-submit-ticket" type="submit" className="btn btn-primary">
                    <Send size={16} /> Abrir Ticket
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="glass-card">
              <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Registro de Envíos y Trazabilidad (RF-8.6)</h3>
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Destinatario</th>
                      <th>Asunto / Mensaje</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <span className="badge badge-info">{n.channel}</span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{n.recipient}</td>
                        <td>{n.subject}</td>
                        <td>
                          <span className="badge badge-success">{n.status}</span>
                        </td>
                        <td style={{ color: '#9ca3af', fontSize: '12px' }}>
                          {new Date(n.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'qr' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Generar QR de Un Solo Uso (RF-8.3)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">ID del Viaje Asignado</label>
                    <input
                      id="input-qr-trip"
                      className="form-input"
                      value={qrTripId}
                      onChange={(e) => setQrTripId(e.target.value)}
                    />
                  </div>
                  <button id="btn-generate-qr" className="btn btn-primary" onClick={handleGenerateQr}>
                    <QrCode size={16} /> Generar Código QR
                  </button>

                  {generatedQr && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <div className="qr-preview-box">
                        <img src={generatedQr.qrDataUrl} alt="QR Code" style={{ width: '180px', height: '180px' }} />
                      </div>
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                        Expira: {new Date(generatedQr.expiresAt).toLocaleTimeString()} (TTL: {generatedQr.ttlSeconds}s)
                      </span>
                      <code style={{ fontSize: '11px', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '6px' }}>
                        Token: {generatedQr.token}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Escanear / Validar QR (Conductor)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Token del QR Escaneado</label>
                    <input
                      id="input-verify-token"
                      className="form-input"
                      placeholder="Token escaneado..."
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                    />
                  </div>
                  <button id="btn-verify-qr" className="btn btn-secondary" onClick={handleVerifyQr}>
                    <ShieldCheck size={16} /> Verificar y Quemar Token
                  </button>

                  {verifyResult && (
                    <div style={{ marginTop: '16px', padding: '16px', borderRadius: '12px', background: verifyResult.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `1px solid ${verifyResult.valid ? '#10b981' : '#ef4444'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: verifyResult.valid ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {verifyResult.valid ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                        {verifyResult.valid ? 'Verificación Exitosa' : 'Verificación Fallida'}
                      </div>
                      <p style={{ fontSize: '13px', marginTop: '6px', color: '#e5e7eb' }}>{verifyResult.message}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'simulator' && (
            <div className="glass-card">
              <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Emulación de Eventos Asíncronos (M5, M6, M7, M9)</h3>
              <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '18px' }}>
                Dispara eventos simulados hacia el módulo para probar la recepción en tiempo real, envío de emails a Mailpit y generación de comprobantes.
              </p>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button id="btn-sim-trip" className="btn btn-primary" onClick={handleSimulateTrip}>
                  <PlayCircle size={16} /> Disparar Evento: Viaje Finalizado (M6)
                </button>
              </div>

              <div style={{ background: '#070a11', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <h4 style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '10px' }}>Log de Eventos Procesados</h4>
                {simulationLog.length === 0 ? (
                  <span style={{ fontSize: '13px', color: '#6b7280' }}>Sin eventos ejecutados en esta sesión.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {simulationLog.map((log, idx) => (
                      <div key={idx} style={{ fontSize: '13px', fontFamily: 'monospace', color: '#38bdf8' }}>
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
