import React, { useState, useEffect, useCallback } from 'react';
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
  FileText,
  Download,
  Mail,
  RefreshCw,
  Clock,
  ArrowRight,
  Database,
  Layers,
  Car,
  CreditCard,
  Calendar,
  Search,
  Filter,
} from 'lucide-react';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'tickets' | 'notifications' | 'documents' | 'qr' | 'simulator'>('overview');
  const [healthStatus, setHealthStatus] = useState<any>(null);

  // ─── Tickets (RF-8.7) ─────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketFilterStatus, setTicketFilterStatus] = useState<string>('ALL');
  const [ticketFilterRef, setTicketFilterRef] = useState<string>('');
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [newTicket, setNewTicket] = useState({
    referenceId: '',
    referenceType: 'TRIP',
    subject: '',
    description: '',
    createdBy: 'pasajero@movilidad.com',
  });
  const [ticketActionMsg, setTicketActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── Notificaciones (RF-8.1, RF-8.6) ──────────────────────────────────────────
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifFilterStatus, setNotifFilterStatus] = useState<string>('ALL');
  const [notifFilterRecipient, setNotifFilterRecipient] = useState<string>('');
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [directNotif, setDirectNotif] = useState({
    channel: 'EMAIL',
    recipient: '',
    subject: '',
    content: '',
    referenceId: '',
    referenceType: 'TRIP',
  });
  const [directNotifMsg, setDirectNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── Comprobantes PDF (RF-8.4, RF-8.5) ────────────────────────────────────────
  const [receiptTripId, setReceiptTripId] = useState('trip-demo-9921');
  const [receiptPassengerId, setReceiptPassengerId] = useState('usr-p-101');
  const [receiptEmail, setReceiptEmail] = useState('pasajero.comprobante@ejemplo.com');
  const [receiptAmount, setReceiptAmount] = useState('3850.00');
  const [receiptDriver, setReceiptDriver] = useState('Roberto Gómez');
  const [receiptRegisterResult, setReceiptRegisterResult] = useState<any>(null);
  const [downloadTripId, setDownloadTripId] = useState('trip-demo-9921');
  const [resendTripId, setResendTripId] = useState('trip-demo-9921');
  const [resendEmail, setResendEmail] = useState('reenvio.destino@ejemplo.com');
  const [resendResult, setResendResult] = useState<any>(null);
  const [resendLoading, setResendLoading] = useState(false);

  // ─── QR (RF-8.3) ─────────────────────────────────────────────────────────────
  const [qrTripId, setQrTripId] = useState('trip-qr-3021');
  const [qrPassengerId, setQrPassengerId] = useState('usr-pax-88');
  const [qrTtlSeconds, setQrTtlSeconds] = useState(300);
  const [generatedQr, setGeneratedQr] = useState<any>(null);
  const [verifyToken, setVerifyToken] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // ─── Simulador (M5, M6, M7, M9) ──────────────────────────────────────────────
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [simSearchFilter, setSimSearchFilter] = useState('');
  const [simModuleFilter, setSimModuleFilter] = useState<string>('ALL');
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [lastEventResponse, setLastEventResponse] = useState<{
    status: number;
    statusText: string;
    isAccepted: boolean;
    eventoId: string;
    recibidoEn: string;
    module: string;
    eventType: string;
    referenceId: string;
    recipient: string;
    rawPayload: any;
    rawResponse: any;
    timestamp: string;
  } | null>(null);

  // M5: Solicitud y Asignación de Viaje
  const [simM5TripRequest, setSimM5TripRequest] = useState({
    viajeId: 'trip-sol-4100',
    passengerEmail: 'pasajero.m5@movilidad.com',
    passengerId: 'usr-m5-pasajero-1',
    origin: 'Av. 9 de Julio 1200, Resistencia',
    destination: 'UTN FRRe - French 414',
    vehicleType: 'AUTO',
    estimatedFare: 3200,
    tipoEvento: 'VIAJE_SOLICITADO',
  });

  // M6: Ciclo y Finalización de Viaje
  const [simTripCompleted, setSimTripCompleted] = useState({
    tripId: 'trip-sim-5501',
    passengerEmail: 'pasajero.viaje@ejemplo.com',
    passengerId: 'usr-m6-pasajero-2',
    driverName: 'Martín Conductor',
    fare: 4200,
    origin: 'Av. San Martín 450',
    destination: 'Aeropuerto Internacional',
    tipoEvento: 'VIAJE_FINALIZADO',
  });

  // M7: Tarifas y Pagos Capturados
  const [simPayment, setSimPayment] = useState({
    paymentId: 'pay-sim-7740',
    tripId: 'trip-sim-5501',
    userEmail: 'pasajero.pago@ejemplo.com',
    userId: 'usr-m7-pasajero-3',
    amount: 3850,
    paymentMethod: 'MERCADOPAGO',
    tipoEvento: 'PAGO_CAPTURADO',
  });

  // M9: Reservas de Viajes Programados
  const [simReservation, setSimReservation] = useState({
    reservationId: 'res-sim-9021',
    passengerEmail: 'pasajero.reserva@ejemplo.com',
    passengerId: 'usr-m9-pasajero-4',
    scheduledTime: '19:30',
    origin: 'Av. Sarmiento 1200',
    destination: 'Shopping Sarmiento',
    estimatedFare: 2950,
    tipoEvento: 'RESERVA_CONFIRMADA',
  });

  // ─── Healthcheck inicial ───────────────────────────────────────────────────────
  const checkHealth = useCallback(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setHealthStatus(data))
      .catch(() => setHealthStatus({ status: 'offline' }));
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // ─── Carga de Tickets desde Supabase (RF-8.7) ─────────────────────────────────
  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    setTicketActionMsg(null);
    try {
      const params = new URLSearchParams();
      if (ticketFilterStatus && ticketFilterStatus !== 'ALL') {
        params.append('status', ticketFilterStatus);
      }
      if (ticketFilterRef.trim()) {
        params.append('referenceId', ticketFilterRef.trim());
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE}/support/tickets${query}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(Array.isArray(data) ? data : []);
      } else {
        setTicketActionMsg({ type: 'error', text: 'Error al consultar tickets en el backend.' });
      }
    } catch {
      setTicketActionMsg({ type: 'error', text: 'No se pudo conectar con la API de soporte.' });
    } finally {
      setLoadingTickets(false);
    }
  }, [ticketFilterStatus, ticketFilterRef]);

  useEffect(() => {
    if (activeTab === 'tickets' || activeTab === 'overview') {
      fetchTickets();
    }
  }, [activeTab, fetchTickets]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setTicketActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket),
      });
      if (res.ok) {
        const created = await res.json();
        setTickets((prev) => [created, ...prev]);
        setNewTicket({
          referenceId: '',
          referenceType: 'TRIP',
          subject: '',
          description: '',
          createdBy: 'pasajero@movilidad.com',
        });
        setTicketActionMsg({ type: 'success', text: `Ticket ${created.ticketNumber} registrado en Supabase.` });
      } else {
        const err = await res.json();
        setTicketActionMsg({ type: 'error', text: err.message || 'Error creando ticket.' });
      }
    } catch {
      setTicketActionMsg({ type: 'error', text: 'Fallo de red al contactar el servidor.' });
    }
  };

  const handleAdvanceTicketStatus = async (ticketId: string, currentStatus: string) => {
    setTicketActionMsg(null);
    const nextStatusMap: Record<string, string> = {
      OPEN: 'IN_PROGRESS',
      IN_PROGRESS: 'RESOLVED',
      RESOLVED: 'CLOSED',
    };
    const nextStatus = nextStatusMap[currentStatus];
    if (!nextStatus) return;

    try {
      const res = await fetch(`${API_BASE}/support/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          resolutionNote: `Transición automática a ${nextStatus} desde el panel de soporte.`,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTickets((prev) => prev.map((t) => (t.id === ticketId || t.ticketNumber === ticketId ? updated : t)));
        setTicketActionMsg({ type: 'success', text: `Ticket actualizado a estado ${nextStatus}.` });
      } else {
        const err = await res.json();
        setTicketActionMsg({ type: 'error', text: err.message || 'Error actualizando estado del ticket.' });
      }
    } catch {
      setTicketActionMsg({ type: 'error', text: 'No se pudo conectar con el servidor.' });
    }
  };

  // ─── Carga de Notificaciones desde Supabase (RF-8.6) ──────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    setDirectNotifMsg(null);
    try {
      const params = new URLSearchParams();
      if (notifFilterStatus && notifFilterStatus !== 'ALL') {
        params.append('status', notifFilterStatus);
      }
      if (notifFilterRecipient.trim()) {
        params.append('recipient', notifFilterRecipient.trim());
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE}/notifications/logs${query}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch {
      // Si falla la conexión directa, se mantiene el estado
    } finally {
      setLoadingNotifs(false);
    }
  }, [notifFilterStatus, notifFilterRecipient]);

  useEffect(() => {
    if (activeTab === 'notifications' || activeTab === 'overview') {
      fetchNotifications();
    }
  }, [activeTab, fetchNotifications]);

  const handleSendDirectNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    setDirectNotifMsg(null);
    try {
      const payload: any = {
        channel: directNotif.channel,
        recipient: directNotif.recipient.trim(),
        subject: directNotif.subject.trim(),
        content: directNotif.content.trim(),
      };
      if (directNotif.referenceId.trim()) {
        payload.referenceId = directNotif.referenceId.trim();
        payload.referenceType = directNotif.referenceType;
      }
      const res = await fetch(`${API_BASE}/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDirectNotifMsg({ type: 'success', text: `Notificación enviada a ${directNotif.recipient}. Estado: ${data.status}` });
        setDirectNotif({
          channel: 'EMAIL',
          recipient: '',
          subject: '',
          content: '',
          referenceId: '',
          referenceType: 'TRIP',
        });
        fetchNotifications();
      } else {
        setDirectNotifMsg({ type: 'error', text: data.message || 'Error al enviar la notificación.' });
      }
    } catch {
      setDirectNotifMsg({ type: 'error', text: 'Error de conexión con el backend.' });
    }
  };

  // ─── Comprobantes PDF (RF-8.4, RF-8.5) ────────────────────────────────────────
  const handleRegisterReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setReceiptRegisterResult(null);
    try {
      const res = await fetch(`${API_BASE}/documents/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: receiptTripId.trim(),
          passengerId: receiptPassengerId.trim(),
          passengerEmail: receiptEmail.trim(),
          amount: parseFloat(receiptAmount) || 1000,
          currency: 'ARS',
          driverName: receiptDriver.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setReceiptRegisterResult({ success: true, data });
        setDownloadTripId(receiptTripId.trim());
        setResendTripId(receiptTripId.trim());
      } else {
        setReceiptRegisterResult({ success: false, message: Array.isArray(data.message) ? data.message.join(', ') : data.message });
      }
    } catch {
      setReceiptRegisterResult({ success: false, message: 'Fallo de conexión al registrar comprobante.' });
    }
  };

  const handleDownloadPdf = (tripIdToDownload: string) => {
    const url = `${API_BASE}/documents/receipts/${encodeURIComponent(tripIdToDownload.trim())}/download`;
    window.open(url, '_blank');
  };

  const handleResendReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendResult(null);
    setResendLoading(true);
    try {
      const res = await fetch(`${API_BASE}/documents/receipts/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: resendTripId.trim(),
          email: resendEmail.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResendResult({
          success: true,
          message: `Comprobante ${data.receiptCode} reenviado exitosamente a ${data.sentTo} con adjunto PDF.`,
        });
        fetchNotifications();
      } else {
        setResendResult({ success: false, message: data.message || 'Error en el reenvío del comprobante.' });
      }
    } catch {
      setResendResult({ success: false, message: 'Error de conexión con el servicio de correo.' });
    } finally {
      setResendLoading(false);
    }
  };

  // ─── QR Code (RF-8.3, RNF-08) ────────────────────────────────────────────────
  const handleGenerateQr = async () => {
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/documents/qr/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: qrTripId.trim(),
          passengerId: qrPassengerId.trim(),
          ttlSeconds: Number(qrTtlSeconds) || 300,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedQr(data);
        setVerifyToken(data.token);
      }
    } catch {
      setVerifyResult({ valid: false, message: 'Error al solicitar generación de QR al backend.' });
    }
  };

  const handleVerifyQr = async () => {
    if (!verifyToken.trim()) {
      setVerifyResult({ valid: false, message: 'Por favor, ingresá un token de QR para verificar.' });
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await fetch(`${API_BASE}/documents/qr/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken.trim(), tripId: qrTripId.trim() }),
      });
      const data = await res.json();
      if (res.ok && (data.valid || res.status === 200)) {
        setVerifyResult({ valid: true, message: data.message || 'Código QR verificado y consumido exitosamente. Inicio de viaje habilitado.' });
      } else {
        setVerifyResult({ valid: false, message: data.message || `Código no válido (${res.status}).` });
      }
    } catch {
      setVerifyResult({ valid: false, message: 'No se pudo conectar con el servidor backend.' });
    } finally {
      setVerifyLoading(false);
    }
  };

  // ─── Simulador de Eventos Oficiales (POST /api/v1/eventos) ───────────────────
  const handleDispatchOfficialEvent = async (mod: 'M5' | 'M6' | 'M7' | 'M9') => {
    setSubmittingEvent(true);
    try {
      const eventoId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'evt-' + Math.random().toString(36).substring(2, 11);
      const ocurridoEn = new Date().toISOString();

      let eventPayload: any;
      let referenceId = '';
      let recipientEmail = '';

      if (mod === 'M5') {
        const viajeId = simM5TripRequest.viajeId || `trip-sol-${Date.now()}`;
        referenceId = viajeId;
        recipientEmail = simM5TripRequest.passengerEmail;
        eventPayload = {
          eventoId,
          tipo: simM5TripRequest.tipoEvento,
          origen: 'M5',
          ocurridoEn,
          viajeId,
          destinatarios: [
            {
              usuarioId: simM5TripRequest.passengerId || `usr-${viajeId}`,
              rol: 'CLIENTE',
              email: simM5TripRequest.passengerEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            origen: simM5TripRequest.origin,
            destino: simM5TripRequest.destination,
            tipoVehiculo: simM5TripRequest.vehicleType,
            importe: {
              monto: Number(simM5TripRequest.estimatedFare) || 3200,
              moneda: 'ARS',
            },
          },
        };
      } else if (mod === 'M6') {
        const viajeId = simTripCompleted.tripId || `trip-sim-${Date.now()}`;
        referenceId = viajeId;
        recipientEmail = simTripCompleted.passengerEmail;
        eventPayload = {
          eventoId,
          tipo: simTripCompleted.tipoEvento,
          origen: 'M6',
          ocurridoEn,
          viajeId,
          destinatarios: [
            {
              usuarioId: simTripCompleted.passengerId || `usr-${viajeId}`,
              rol: 'CLIENTE',
              email: simTripCompleted.passengerEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            origen: simTripCompleted.origin,
            destino: simTripCompleted.destination,
            motivo: `Conductor asignado: ${simTripCompleted.driverName}`,
            importe: {
              monto: Number(simTripCompleted.fare) || 4200,
              moneda: 'ARS',
            },
          },
        };
      } else if (mod === 'M7') {
        const pagoId = simPayment.paymentId || `pay-${Date.now()}`;
        const viajeId = simPayment.tripId || `trip-pay-${Date.now()}`;
        referenceId = pagoId;
        recipientEmail = simPayment.userEmail;
        eventPayload = {
          eventoId,
          tipo: simPayment.tipoEvento,
          origen: 'M7',
          ocurridoEn,
          pagoId,
          viajeId,
          destinatarios: [
            {
              usuarioId: simPayment.userId || `usr-${pagoId}`,
              rol: 'CLIENTE',
              email: simPayment.userEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            motivo: `Acreditación de pago por ${simPayment.paymentMethod}`,
            importe: {
              monto: Number(simPayment.amount) || 3850,
              moneda: 'ARS',
            },
          },
        };
      } else if (mod === 'M9') {
        const reservaId = simReservation.reservationId || `res-${Date.now()}`;
        referenceId = reservaId;
        recipientEmail = simReservation.passengerEmail;
        eventPayload = {
          eventoId,
          tipo: simReservation.tipoEvento,
          origen: 'M9',
          ocurridoEn,
          reservaId,
          destinatarios: [
            {
              usuarioId: simReservation.passengerId || `usr-${reservaId}`,
              rol: 'CLIENTE',
              email: simReservation.passengerEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            origen: simReservation.origin,
            destino: simReservation.destination,
            fechaProgramada: new Date(Date.now() + 86400000).toISOString(),
            motivo: `Reserva confirmada para las ${simReservation.scheduledTime}`,
            importe: {
              monto: Number(simReservation.estimatedFare) || 2950,
              moneda: 'ARS',
            },
          },
        };
      }

      const res = await fetch(`${API_BASE}/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload),
      });

      const data = await res.json().catch(() => ({}));
      const isAccepted = res.status === 202;
      const timeStr = new Date().toLocaleTimeString();

      setLastEventResponse({
        status: res.status,
        statusText: isAccepted ? '202 Accepted' : `${res.status} ${res.statusText}`,
        isAccepted,
        eventoId: data.eventoId || eventoId,
        recibidoEn: data.recibidoEn || ocurridoEn,
        module: mod,
        eventType: eventPayload.tipo,
        referenceId,
        recipient: recipientEmail,
        rawPayload: eventPayload,
        rawResponse: data,
        timestamp: timeStr,
      });

      const logMsg = `[${timeStr}] [HTTP ${res.status} ${isAccepted ? 'Accepted' : 'Error'}] ${mod}: ${eventPayload.tipo} (#${referenceId}) -> Evento recibido (${(data.eventoId || eventoId).slice(0, 8)}...). Email despachado a ${recipientEmail}`;
      setSimulationLog((prev) => [logMsg, ...prev]);

      fetchNotifications();
      if ((mod === 'M6' || mod === 'M7') && eventPayload.viajeId) {
        setDownloadTripId(eventPayload.viajeId);
        setResendTripId(eventPayload.viajeId);
      }
    } catch (err: any) {
      const timeStr = new Date().toLocaleTimeString();
      const errText = `[${timeStr}] [Error de Red] No se pudo conectar con el endpoint POST ${API_BASE}/eventos: ${err.message || 'Servidor offline'}`;
      setSimulationLog((prev) => [errText, ...prev]);
    } finally {
      setSubmittingEvent(false);
    }
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
            Notificaciones (RF-8.1, 8.6)
          </button>
          <button
            id="nav-documents"
            className={`nav-item ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            <FileText size={18} />
            Comprobantes PDF (RF-8.4, 8.5)
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
          <a
            href="http://localhost:8025"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '6px 12px', textDecoration: 'none' }}
          >
            <Mail size={14} /> Bandeja Mailpit
          </a>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <h2 className="page-title">
            {activeTab === 'overview' && 'Panel de Control - Módulo 8'}
            {activeTab === 'tickets' && 'Gestión de Tickets y Soporte (RF-8.7)'}
            {activeTab === 'notifications' && 'Notificaciones y Auditoría (RF-8.1, RF-8.6)'}
            {activeTab === 'documents' && 'Emisión y Descarga de Comprobantes PDF (RF-8.4, RF-8.5)'}
            {activeTab === 'qr' && 'Generador y Escáner de Códigos QR (RF-8.3)'}
            {activeTab === 'simulator' && 'Emulador de Eventos Asíncronos (M5, M6, M7, M9)'}
          </h2>
          <div className="top-bar-actions">
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>Plataforma de Movilidad Urbana</span>
          </div>
        </header>

        <div className="content-body">
          {/* ─── TAB: OVERVIEW ─────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              <div className="stats-grid">
                <div className="glass-card stat-item">
                  <span className="stat-label">Tickets en Supabase</span>
                  <span className="stat-value" style={{ color: '#6366f1' }}>{tickets.length}</span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Notificaciones Registradas</span>
                  <span className="stat-value" style={{ color: '#10b981' }}>{notifications.length}</span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Estado de la Base de Datos</span>
                  <span className="stat-value" style={{ color: '#38bdf8', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Database size={20} /> Supabase PostgreSQL
                  </span>
                </div>
                <div className="glass-card stat-item">
                  <span className="stat-label">Consumo Seguro de QR</span>
                  <span className="stat-value" style={{ color: '#d946ef' }}>TTL 300s (Redis)</span>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Arquitectura Hexagonal del Módulo 8</h3>
                <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.6' }}>
                  El microservicio implementa arquitectura hexagonal desacoplando el núcleo de dominio de la infraestructura (Prisma ORM sobre Supabase Cloud, Redis 7 para atomicidad de QR de un solo uso, RabbitMQ para eventos de fin de viaje y reservas, y Nodemailer sobre Mailpit para entrega de comprobantes oficiales con PDF vectorial).
                </p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => setActiveTab('simulator')}>
                    <PlayCircle size={16} /> Probar Simulador de Eventos
                  </button>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('documents')}>
                    <FileText size={16} /> Comprobantes y Descarga PDF
                  </button>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('tickets')}>
                    <LifeBuoy size={16} /> Ver Tickets en Vivo
                  </button>
                  <a
                    href="http://localhost:8025"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    <Mail size={16} /> Ver Bandeja SMTP Mailpit
                  </a>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} /> Componentes de Infraestructura y Persistencia (RNF-04 / RNF-05)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>PostgreSQL Cloud</div>
                    <div style={{ fontWeight: 600, color: '#10b981', marginTop: '4px' }}>Supabase Conectado</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>5 Tablas Sincronizadas</div>
                  </div>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>Caché Efímero & TTL</div>
                    <div style={{ fontWeight: 600, color: '#10b981', marginTop: '4px' }}>Redis 7 Activo (6379)</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>getDel Atómico (RNF-08)</div>
                  </div>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>Broker de Mensajería</div>
                    <div style={{ fontWeight: 600, color: '#10b981', marginTop: '4px' }}>RabbitMQ 3 (5672)</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>Cola m8_notifications_queue</div>
                  </div>
                  <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>Servidor SMTP de Pruebas</div>
                    <div style={{ fontWeight: 600, color: '#10b981', marginTop: '4px' }}>Mailpit (1025 / 8025)</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>Recepción con PDFs adjuntos</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: TICKETS (RF-8.7) ─────────────────────────────────────────── */}
          {activeTab === 'tickets' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '24px' }}>
              <div className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <h3 style={{ fontSize: '18px' }}>Listado de Tickets en Supabase ({tickets.length})</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      className="form-select"
                      style={{ padding: '6px 10px', fontSize: '12px' }}
                      value={ticketFilterStatus}
                      onChange={(e) => setTicketFilterStatus(e.target.value)}
                    >
                      <option value="ALL">Todos los Estados</option>
                      <option value="OPEN">OPEN</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="RESOLVED">RESOLVED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                    <input
                      className="form-input"
                      placeholder="Filtrar por Ref ID..."
                      style={{ padding: '6px 10px', fontSize: '12px', width: '130px' }}
                      value={ticketFilterRef}
                      onChange={(e) => setTicketFilterRef(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={fetchTickets}>
                      <RefreshCw size={14} className={loadingTickets ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                {ticketActionMsg && (
                  <div
                    style={{
                      marginBottom: '14px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: ticketActionMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: ticketActionMsg.type === 'success' ? '#10b981' : '#ef4444',
                      fontSize: '13px',
                    }}
                  >
                    {ticketActionMsg.text}
                  </div>
                )}

                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Ref</th>
                        <th>Asunto</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#6b7280', padding: '24px' }}>
                            {loadingTickets ? 'Cargando tickets de Supabase...' : 'No se encontraron tickets con los filtros aplicados.'}
                          </td>
                        </tr>
                      ) : (
                        tickets.map((t) => (
                          <tr key={t.id}>
                            <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{t.ticketNumber}</td>
                            <td>
                              <span className="badge badge-info">{t.referenceType}: {t.referenceId}</span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{t.subject}</div>
                              <div style={{ fontSize: '12px', color: '#9ca3af', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {t.description}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${
                                  t.status === 'RESOLVED'
                                    ? 'badge-success'
                                    : t.status === 'IN_PROGRESS'
                                    ? 'badge-info'
                                    : t.status === 'OPEN'
                                    ? 'badge-warning'
                                    : 'badge-secondary'
                                }`}
                              >
                                {t.status}
                              </span>
                            </td>
                            <td style={{ color: '#9ca3af', fontSize: '12px' }}>
                              {new Date(t.createdAt).toLocaleDateString()}
                            </td>
                            <td>
                              {t.status === 'OPEN' && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleAdvanceTicketStatus(t.id, 'OPEN')}
                                  title="Avanzar a IN_PROGRESS"
                                >
                                  Iniciar <ArrowRight size={12} />
                                </button>
                              )}
                              {t.status === 'IN_PROGRESS' && (
                                <button
                                  className="btn btn-success btn-sm"
                                  onClick={() => handleAdvanceTicketStatus(t.id, 'IN_PROGRESS')}
                                  title="Avanzar a RESOLVED"
                                >
                                  Resolver <CheckCircle size={12} />
                                </button>
                              )}
                              {t.status === 'RESOLVED' && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleAdvanceTicketStatus(t.id, 'RESOLVED')}
                                  title="Cerrar ticket definitivamente"
                                >
                                  Cerrar
                                </button>
                              )}
                              {t.status === 'CLOSED' && (
                                <span style={{ fontSize: '11px', color: '#6b7280' }}>Finalizado</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Crear Ticket (RF-8.7)</h3>
                <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">ID de Referencia</label>
                    <input
                      id="input-ticket-ref"
                      className="form-input"
                      placeholder="Ej. trip-9821 / res-504"
                      required
                      value={newTicket.referenceId}
                      onChange={(e) => setNewTicket({ ...newTicket, referenceId: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo de Referencia</label>
                    <select
                      className="form-select"
                      value={newTicket.referenceType}
                      onChange={(e) => setNewTicket({ ...newTicket, referenceType: e.target.value })}
                    >
                      <option value="TRIP">Viaje (TRIP)</option>
                      <option value="RESERVATION">Reserva (RESERVATION)</option>
                      <option value="PAYMENT">Pago (PAYMENT)</option>
                      <option value="OTHER">Otro (OTHER)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Asunto (Mín. 5 letras)</label>
                    <input
                      id="input-ticket-subject"
                      className="form-input"
                      placeholder="Resumen del reclamo o consulta"
                      required
                      minLength={5}
                      value={newTicket.subject}
                      onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Descripción (Mín. 10 letras)</label>
                    <textarea
                      id="input-ticket-desc"
                      className="form-textarea"
                      rows={3}
                      placeholder="Detalle completo de la solicitud..."
                      required
                      minLength={10}
                      value={newTicket.description}
                      onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Creado Por (Email o Usuario)</label>
                    <input
                      className="form-input"
                      required
                      value={newTicket.createdBy}
                      onChange={(e) => setNewTicket({ ...newTicket, createdBy: e.target.value })}
                    />
                  </div>
                  <button id="btn-submit-ticket" type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
                    <Send size={16} /> Abrir Ticket en Supabase
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ─── TAB: NOTIFICACIONES (RF-8.1, RF-8.6) ───────────────────────────── */}
          {activeTab === 'notifications' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '24px' }}>
              <div className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <h3 style={{ fontSize: '18px' }}>Auditoría y Logs de Envíos en Supabase ({notifications.length})</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      className="form-select"
                      style={{ padding: '6px 10px', fontSize: '12px' }}
                      value={notifFilterStatus}
                      onChange={(e) => setNotifFilterStatus(e.target.value)}
                    >
                      <option value="ALL">Todos los Estados</option>
                      <option value="SENT">SENT (Exitosos)</option>
                      <option value="FAILED">FAILED (Fallidos)</option>
                      <option value="PENDING">PENDING</option>
                    </select>
                    <input
                      className="form-input"
                      placeholder="Filtrar por Destinatario..."
                      style={{ padding: '6px 10px', fontSize: '12px', width: '150px' }}
                      value={notifFilterRecipient}
                      onChange={(e) => setNotifFilterRecipient(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={fetchNotifications}>
                      <RefreshCw size={14} className={loadingNotifs ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Destinatario</th>
                        <th>Asunto & Contenido</th>
                        <th>Ref</th>
                        <th>Estado</th>
                        <th>Reintentos</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notifications.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', color: '#6b7280', padding: '24px' }}>
                            {loadingNotifs ? 'Cargando registros...' : 'No hay registros de notificaciones con estos filtros.'}
                          </td>
                        </tr>
                      ) : (
                        notifications.map((n) => (
                          <tr key={n.id}>
                            <td>
                              <span className="badge badge-info">{n.channel}</span>
                            </td>
                            <td style={{ fontWeight: 500, fontSize: '13px' }}>{n.recipient}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{n.subject}</div>
                              <div style={{ fontSize: '12px', color: '#9ca3af', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {n.content}
                              </div>
                            </td>
                            <td>
                              {n.referenceId ? (
                                <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                                  {n.referenceType || 'REF'}: {n.referenceId}
                                </span>
                              ) : (
                                <span style={{ color: '#6b7280', fontSize: '11px' }}>-</span>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${n.status === 'SENT' ? 'badge-success' : n.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                                {n.status}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', fontSize: '12px', color: n.retryCount > 0 ? '#f59e0b' : '#9ca3af' }}>
                              {n.retryCount || 0}
                            </td>
                            <td style={{ color: '#9ca3af', fontSize: '11px' }}>
                              {new Date(n.createdAt).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Enviar Notificación (RF-8.1)</h3>
                {directNotifMsg && (
                  <div
                    style={{
                      marginBottom: '14px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: directNotifMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: directNotifMsg.type === 'success' ? '#10b981' : '#ef4444',
                      fontSize: '13px',
                    }}
                  >
                    {directNotifMsg.text}
                  </div>
                )}
                <form onSubmit={handleSendDirectNotification} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Canal</label>
                    <select
                      className="form-select"
                      value={directNotif.channel}
                      onChange={(e) => setDirectNotif({ ...directNotif, channel: e.target.value })}
                    >
                      <option value="EMAIL">Email (Nodemailer / Mailpit)</option>
                      <option value="PUSH">Push Notification</option>
                      <option value="SMS">SMS Gateway</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Destinatario (Email)</label>
                    <input
                      className="form-input"
                      type="email"
                      required
                      placeholder="pasajero@ejemplo.com"
                      value={directNotif.recipient}
                      onChange={(e) => setDirectNotif({ ...directNotif, recipient: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Asunto</label>
                    <input
                      className="form-input"
                      required
                      placeholder="Ej. Conductor en camino"
                      value={directNotif.subject}
                      onChange={(e) => setDirectNotif({ ...directNotif, subject: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mensaje / Contenido</label>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      required
                      placeholder="El vehículo Toyota Corolla arribará en 3 minutos..."
                      value={directNotif.content}
                      onChange={(e) => setDirectNotif({ ...directNotif, content: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">ID de Referencia (Opcional)</label>
                    <input
                      className="form-input"
                      placeholder="trip-1234 / res-567"
                      value={directNotif.referenceId}
                      onChange={(e) => setDirectNotif({ ...directNotif, referenceId: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
                    <Send size={16} /> Despachar Notificación
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ─── TAB: COMPROBANTES Y PDF (RF-8.4, RF-8.5) ───────────────────────── */}
          {activeTab === 'documents' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} /> Registrar Comprobante de Viaje (RF-8.4)
                </h3>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '16px' }}>
                  Persiste los metadatos del viaje en PostgreSQL Supabase con idempotencia por tripId. El PDF se genera bajo demanda vectorialmente al descargar.
                </p>
                <form onSubmit={handleRegisterReceipt} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">ID del Viaje (tripId)</label>
                      <input
                        className="form-input"
                        required
                        value={receiptTripId}
                        onChange={(e) => setReceiptTripId(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">ID del Pasajero</label>
                      <input
                        className="form-input"
                        required
                        value={receiptPassengerId}
                        onChange={(e) => setReceiptPassengerId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Email del Pasajero</label>
                    <input
                      className="form-input"
                      type="email"
                      required
                      value={receiptEmail}
                      onChange={(e) => setReceiptEmail(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Importe Total (ARS)</label>
                      <input
                        className="form-input"
                        type="number"
                        step="0.01"
                        required
                        value={receiptAmount}
                        onChange={(e) => setReceiptAmount(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Conductor Asignado</label>
                      <input
                        className="form-input"
                        value={receiptDriver}
                        onChange={(e) => setReceiptDriver(e.target.value)}
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
                    <CheckCircle size={16} /> Emitir Comprobante (POST)
                  </button>

                  {receiptRegisterResult && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: receiptRegisterResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        border: `1px solid ${receiptRegisterResult.success ? '#10b981' : '#ef4444'}`,
                      }}
                    >
                      {receiptRegisterResult.success ? (
                        <div>
                          <div style={{ fontWeight: 600, color: '#10b981' }}>Comprobante Registrado:</div>
                          <div style={{ fontFamily: 'monospace', marginTop: '4px', fontSize: '13px' }}>
                            Código: <strong>{receiptRegisterResult.data.receiptCode}</strong>
                          </div>
                          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                            Viaje: {receiptRegisterResult.data.tripId} | Emisión: {new Date(receiptRegisterResult.data.issuedAt).toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#ef4444', fontSize: '13px' }}>{receiptRegisterResult.message}</div>
                      )}
                    </div>
                  )}
                </form>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Descarga directa de PDF */}
                <div className="glass-card">
                  <h3 style={{ marginBottom: '14px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Download size={18} /> Descargar PDF Oficial (RF-8.4)
                  </h3>
                  <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '14px' }}>
                    Genera bajo demanda el archivo binario PDF mediante el adaptador vectorial PDFKit y lo descarga en el navegador.
                  </p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      className="form-input"
                      placeholder="Ingresá el tripId del comprobante"
                      value={downloadTripId}
                      onChange={(e) => setDownloadTripId(e.target.value)}
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDownloadPdf(downloadTripId)}
                    >
                      <Download size={16} /> Descargar PDF
                    </button>
                  </div>
                </div>

                {/* Reenvío por Correo */}
                <div className="glass-card">
                  <h3 style={{ marginBottom: '14px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Mail size={18} /> Reenviar Comprobante con PDF Adjunto (RF-8.5)
                  </h3>
                  <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '14px' }}>
                    Regenera el PDF con la fecha y código originales y lo despacha como archivo adjunto al correo indicado a través de Nodemailer / Mailpit.
                  </p>
                  <form onSubmit={handleResendReceipt} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div className="form-group">
                        <label className="form-label">ID del Viaje</label>
                        <input
                          className="form-input"
                          required
                          value={resendTripId}
                          onChange={(e) => setResendTripId(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Email de Destino</label>
                        <input
                          className="form-input"
                          type="email"
                          required
                          value={resendEmail}
                          onChange={(e) => setResendEmail(e.target.value)}
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={resendLoading}>
                      <Send size={16} /> {resendLoading ? 'Enviando correo...' : 'Reenviar Comprobante por Email'}
                    </button>
                  </form>

                  {resendResult && (
                    <div
                      style={{
                        marginTop: '14px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: resendResult.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        border: `1px solid ${resendResult.success ? '#10b981' : '#ef4444'}`,
                        color: resendResult.success ? '#10b981' : '#ef4444',
                        fontSize: '13px',
                      }}
                    >
                      {resendResult.message}
                      {resendResult.success && (
                        <div style={{ marginTop: '8px' }}>
                          <a
                            href="http://localhost:8025"
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#38bdf8', textDecoration: 'underline', fontSize: '12px' }}
                          >
                            Abrir Mailpit para ver el correo con el PDF adjunto &rarr;
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB: QR (RF-8.3, RNF-08) ──────────────────────────────────────── */}
          {activeTab === 'qr' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Generar QR Temporal de Un Solo Uso (RF-8.3)</h3>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">ID del Pasajero</label>
                      <input
                        className="form-input"
                        value={qrPassengerId}
                        onChange={(e) => setQrPassengerId(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">TTL en Segundos (Redis)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={qrTtlSeconds}
                        onChange={(e) => setQrTtlSeconds(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <button id="btn-generate-qr" className="btn btn-primary" onClick={handleGenerateQr}>
                    <QrCode size={16} /> Generar Código QR
                  </button>

                  {generatedQr && (
                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <div className="qr-preview-box">
                        <img src={generatedQr.qrDataUrl} alt="QR Code" style={{ width: '180px', height: '180px' }} />
                      </div>
                      <span style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={14} /> Expira: {new Date(generatedQr.expiresAt).toLocaleTimeString()} (TTL: {generatedQr.ttlSeconds}s)
                      </span>
                      <code style={{ fontSize: '11px', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '6px' }}>
                        Token: {generatedQr.token}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card">
                <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Escanear y Consumir QR (Conductor / RF-6.4)</h3>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '14px' }}>
                  El conductor escanea el código para habilitar el inicio del viaje. La verificación utiliza consumo atómico en Redis (RNF-08), por lo que solo puede validarse exitosamente una única vez.
                </p>
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
                  <button id="btn-verify-qr" className="btn btn-secondary" onClick={handleVerifyQr} disabled={verifyLoading}>
                    <ShieldCheck size={16} /> {verifyLoading ? 'Verificando...' : 'Verificar y Quemar Token (200 OK)'}
                  </button>

                  {verifyResult && (
                    <div
                      style={{
                        marginTop: '16px',
                        padding: '16px',
                        borderRadius: '12px',
                        background: verifyResult.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${verifyResult.valid ? '#10b981' : '#ef4444'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: verifyResult.valid ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {verifyResult.valid ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                        {verifyResult.valid ? 'Verificación Exitosa' : 'Verificación Fallida (Quemado o Expirado)'}
                      </div>
                      <p style={{ fontSize: '13px', marginTop: '6px', color: '#e5e7eb' }}>{verifyResult.message}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB: SIMULADOR (M5, M6, M7, M9 - RF-8.8, RNF-15) ───────────────── */}
          {activeTab === 'simulator' && (
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ marginBottom: '6px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PlayCircle size={20} color="#6366f1" />
                    Emulador y Simulador de Eventos Oficiales (POST /api/v1/eventos)
                  </h3>
                  <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>
                    Dispara eventos simulados hacia el endpoint unificado de la plataforma. El backend responde inmediatamente con <strong>HTTP 202 Accepted</strong> (asíncrono) y despacha las notificaciones por email a Mailpit y comprobantes en PDF.
                  </p>
                </div>
              </div>

              {/* ─── BANNER ACCESO DIRECTO MAILPIT (LOCALHOST:8025) ─── */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'linear-gradient(90deg, rgba(56, 189, 248, 0.12), rgba(99, 102, 241, 0.12))',
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  marginBottom: '22px',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f3f4f6', fontWeight: 600, fontSize: '14px' }}>
                    <Mail size={18} color="#38bdf8" />
                    Bandeja Local de Correos (Mailpit)
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '2px' }}>
                    Servidor SMTP local para inspeccionar y validar los correos generados con sus plantillas y comprobantes PDF adjuntos.
                  </div>
                </div>
                <a
                  id="btn-open-mailpit"
                  href="http://localhost:8025"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <Mail size={15} /> Abrir Mailpit (localhost:8025) <ExternalLink size={14} />
                </a>
              </div>

              {/* ─── VISUALIZACIÓN EN TIEMPO REAL: RESPUESTA HTTP 202 ACCEPTED ─── */}
              {lastEventResponse && (
                <div
                  style={{
                    marginBottom: '24px',
                    padding: '18px 20px',
                    borderRadius: '12px',
                    background: lastEventResponse.isAccepted ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    border: `1px solid ${lastEventResponse.isAccepted ? '#10b981' : '#ef4444'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        className={`badge ${lastEventResponse.isAccepted ? 'badge-success' : 'badge-danger'}`}
                        style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }}
                      >
                        HTTP {lastEventResponse.statusText}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: '#f3f4f6' }}>
                        {lastEventResponse.isAccepted
                          ? 'Evento Recibido y Encolado para Procesamiento Asíncrono'
                          : 'Fallo al Procesar Evento en el Backend'}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>{lastEventResponse.timestamp}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '12px', color: '#d1d5db' }}>
                    <div>
                      <span style={{ color: '#9ca3af', display: 'block', marginBottom: '2px' }}>ID de Idempotencia (eventoId):</span>
                      <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: '#38bdf8' }}>
                        {lastEventResponse.eventoId}
                      </code>
                    </div>
                    <div>
                      <span style={{ color: '#9ca3af', display: 'block', marginBottom: '2px' }}>Módulo & Tipo de Hito:</span>
                      <span className="badge badge-info" style={{ marginRight: '6px' }}>{lastEventResponse.module}</span>
                      <strong style={{ color: '#f3f4f6' }}>{lastEventResponse.eventType}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#9ca3af', display: 'block', marginBottom: '2px' }}>Referencia Asociada:</span>
                      <span>#{lastEventResponse.referenceId}</span>
                    </div>
                    <div>
                      <span style={{ color: '#9ca3af', display: 'block', marginBottom: '2px' }}>Destinatario Notificado:</span>
                      <span style={{ color: '#10b981' }}>{lastEventResponse.recipient}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                      Timestamp del servidor: <code>{lastEventResponse.recibidoEn}</code>
                    </span>
                    <a
                      href="http://localhost:8025"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#38bdf8', fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Mail size={13} /> Ver correo entregado en Mailpit &rarr;
                    </a>
                  </div>
                </div>
              )}

              {/* ─── FORMULARIOS INTERACTIVOS POR MÓDULO (M5, M6, M7, M9) ─── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                {/* ── M5: Solicitud de Viaje ── */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Car size={16} /> M5: Solicitud de Viaje
                    </div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
                      Informa la solicitud inicial o asignación de móvil a un pasajero (RF-8.1).
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Tipo de Evento</label>
                        <select
                          className="form-select"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simM5TripRequest.tipoEvento}
                          onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, tipoEvento: e.target.value })}
                        >
                          <option value="VIAJE_SOLICITADO">VIAJE_SOLICITADO</option>
                          <option value="VIAJE_ASIGNADO">VIAJE_ASIGNADO</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>ID de Viaje</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simM5TripRequest.viajeId}
                          onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, viajeId: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Email Pasajero</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simM5TripRequest.passengerEmail}
                          onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, passengerEmail: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Origen</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simM5TripRequest.origin}
                          onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, origin: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Destino</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simM5TripRequest.destination}
                          onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, destination: e.target.value })}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div className="form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Vehículo</label>
                          <select
                            className="form-select"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            value={simM5TripRequest.vehicleType}
                            onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, vehicleType: e.target.value })}
                          >
                            <option value="AUTO">AUTO</option>
                            <option value="MOTO">MOTO</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Estimado ($)</label>
                          <input
                            type="number"
                            className="form-input"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            value={simM5TripRequest.estimatedFare}
                            onChange={(e) => setSimM5TripRequest({ ...simM5TripRequest, estimatedFare: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    id="btn-simulate-m5"
                    className="btn btn-primary"
                    style={{ marginTop: '14px', width: '100%', fontSize: '13px' }}
                    onClick={() => handleDispatchOfficialEvent('M5')}
                    disabled={submittingEvent}
                  >
                    <PlayCircle size={15} /> Disparar Evento M5
                  </button>
                </div>

                {/* ── M6: Viaje Finalizado ── */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#6366f1', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <PlayCircle size={16} /> M6: Viaje Finalizado
                    </div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
                      Genera comprobante PDF oficial en Supabase y despacha correo a Mailpit.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Tipo de Evento</label>
                        <select
                          className="form-select"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simTripCompleted.tipoEvento}
                          onChange={(e) => setSimTripCompleted({ ...simTripCompleted, tipoEvento: e.target.value })}
                        >
                          <option value="VIAJE_FINALIZADO">VIAJE_FINALIZADO</option>
                          <option value="VIAJE_ARRIBO_CONDUCTOR">VIAJE_ARRIBO_CONDUCTOR</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>ID de Viaje (tripId)</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simTripCompleted.tripId}
                          onChange={(e) => setSimTripCompleted({ ...simTripCompleted, tripId: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Email Pasajero</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simTripCompleted.passengerEmail}
                          onChange={(e) => setSimTripCompleted({ ...simTripCompleted, passengerEmail: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Nombre Conductor</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simTripCompleted.driverName}
                          onChange={(e) => setSimTripCompleted({ ...simTripCompleted, driverName: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Tarifa Total ($ ARS)</label>
                        <input
                          type="number"
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simTripCompleted.fare}
                          onChange={(e) => setSimTripCompleted({ ...simTripCompleted, fare: Number(e.target.value) })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Origen y Destino</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <input
                            className="form-input"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            placeholder="Origen"
                            value={simTripCompleted.origin}
                            onChange={(e) => setSimTripCompleted({ ...simTripCompleted, origin: e.target.value })}
                          />
                          <input
                            className="form-input"
                            style={{ padding: '5px 8px', fontSize: '12px' }}
                            placeholder="Destino"
                            value={simTripCompleted.destination}
                            onChange={(e) => setSimTripCompleted({ ...simTripCompleted, destination: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    id="btn-simulate-m6"
                    className="btn btn-primary"
                    style={{ marginTop: '14px', width: '100%', fontSize: '13px' }}
                    onClick={() => handleDispatchOfficialEvent('M6')}
                    disabled={submittingEvent}
                  >
                    <PlayCircle size={15} /> Disparar Evento M6
                  </button>
                </div>

                {/* ── M7: Pago Capturado ── */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#10b981', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CreditCard size={16} /> M7: Pago Capturado
                    </div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
                      Notifica la acreditación de cobro por pasarela y registra el comprobante digital.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Tipo de Evento</label>
                        <select
                          className="form-select"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.tipoEvento}
                          onChange={(e) => setSimPayment({ ...simPayment, tipoEvento: e.target.value })}
                        >
                          <option value="PAGO_CAPTURADO">PAGO_CAPTURADO</option>
                          <option value="REINTEGRO_REGISTRADO">REINTEGRO_REGISTRADO</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>ID de Pago (paymentId)</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.paymentId}
                          onChange={(e) => setSimPayment({ ...simPayment, paymentId: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>ID de Viaje (tripId)</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.tripId}
                          onChange={(e) => setSimPayment({ ...simPayment, tripId: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Email del Usuario</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.userEmail}
                          onChange={(e) => setSimPayment({ ...simPayment, userEmail: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Monto ($ ARS)</label>
                        <input
                          type="number"
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.amount}
                          onChange={(e) => setSimPayment({ ...simPayment, amount: Number(e.target.value) })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Método de Pago</label>
                        <select
                          className="form-select"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simPayment.paymentMethod}
                          onChange={(e) => setSimPayment({ ...simPayment, paymentMethod: e.target.value })}
                        >
                          <option value="MERCADOPAGO">Mercado Pago</option>
                          <option value="TARJETA_CREDITO">Tarjeta de Crédito</option>
                          <option value="EFECTIVO">Efectivo</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    id="btn-simulate-m7"
                    className="btn btn-primary"
                    style={{ marginTop: '14px', width: '100%', fontSize: '13px' }}
                    onClick={() => handleDispatchOfficialEvent('M7')}
                    disabled={submittingEvent}
                  >
                    <PlayCircle size={15} /> Disparar Evento M7
                  </button>
                </div>

                {/* ── M9: Reserva Confirmada ── */}
                <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={16} /> M9: Reserva Confirmada
                    </div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
                      Notifica la confirmación de viaje programado y emite recordatorios por correo.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Tipo de Evento</label>
                        <select
                          className="form-select"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.tipoEvento}
                          onChange={(e) => setSimReservation({ ...simReservation, tipoEvento: e.target.value })}
                        >
                          <option value="RESERVA_CONFIRMADA">RESERVA_CONFIRMADA</option>
                          <option value="RESERVA_RECORDATORIO">RESERVA_RECORDATORIO</option>
                          <option value="RESERVA_CREADA">RESERVA_CREADA</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>ID de Reserva</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.reservationId}
                          onChange={(e) => setSimReservation({ ...simReservation, reservationId: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Email Pasajero</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.passengerEmail}
                          onChange={(e) => setSimReservation({ ...simReservation, passengerEmail: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Horario Programado</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.scheduledTime}
                          onChange={(e) => setSimReservation({ ...simReservation, scheduledTime: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Origen</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.origin}
                          onChange={(e) => setSimReservation({ ...simReservation, origin: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '11px' }}>Destino</label>
                        <input
                          className="form-input"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          value={simReservation.destination}
                          onChange={(e) => setSimReservation({ ...simReservation, destination: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    id="btn-simulate-m9"
                    className="btn btn-primary"
                    style={{ marginTop: '14px', width: '100%', fontSize: '13px' }}
                    onClick={() => handleDispatchOfficialEvent('M9')}
                    disabled={submittingEvent}
                  >
                    <PlayCircle size={15} /> Disparar Evento M9
                  </button>
                </div>
              </div>

              {/* ─── CONSOLA DE AUDITORÍA CON FILTROS DINÁMICOS Y BUSCADOR (RNF-15) ─── */}
              <div style={{ background: '#070a11', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h4 style={{ fontSize: '14px', color: '#f3f4f6', margin: 0, fontWeight: 600 }}>
                      Consola de Eventos en Tiempo Real ({simulationLog.length})
                    </h4>
                    {/* Filtros dinámicos por módulo */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Filter size={12} /> Módulo:
                      </span>
                      <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', padding: '2px' }}>
                        {['ALL', 'M5', 'M6', 'M7', 'M9'].map((m) => (
                          <button
                            key={m}
                            style={{
                              background: simModuleFilter === m ? '#6366f1' : 'transparent',
                              color: simModuleFilter === m ? '#fff' : '#9ca3af',
                              border: 'none',
                              padding: '4px 10px',
                              fontSize: '11px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: simModuleFilter === m ? 600 : 400,
                            }}
                            onClick={() => setSimModuleFilter(m)}
                          >
                            {m === 'ALL' ? 'Todos' : m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Buscador reactivo en vivo */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        placeholder="Buscar por ID, evento o email..."
                        style={{ padding: '6px 10px 6px 28px', fontSize: '12px', width: '220px' }}
                        value={simSearchFilter}
                        onChange={(e) => setSimSearchFilter(e.target.value)}
                      />
                      <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    </div>
                    {simulationLog.length > 0 && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '6px 10px', fontSize: '11px' }}
                        onClick={() => setSimulationLog([])}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {/* Lista filtrada de logs */}
                {(() => {
                  const filtered = simulationLog.filter((log) => {
                    const matchesModule =
                      simModuleFilter === 'ALL' || log.includes(`] ${simModuleFilter}:`) || log.includes(`${simModuleFilter} ->`);
                    const matchesSearch =
                      !simSearchFilter.trim() || log.toLowerCase().includes(simSearchFilter.toLowerCase().trim());
                    return matchesModule && matchesSearch;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '24px 12px', color: '#6b7280', fontSize: '13px' }}>
                        {simulationLog.length === 0
                          ? 'Sin eventos ejecutados en esta sesión. Selecciona un módulo arriba y haz clic en "Disparar Evento".'
                          : 'No se encontraron eventos que coincidan con los filtros aplicados.'}
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                      {filtered.map((log, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            color: log.includes('202 Accepted') ? '#38bdf8' : log.includes('Error') ? '#ef4444' : '#e5e7eb',
                            background: 'rgba(255,255,255,0.03)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            borderLeft: `3px solid ${log.includes('202') ? '#10b981' : log.includes('Error') ? '#ef4444' : '#6366f1'}`,
                          }}
                        >
                          {log}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
