import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Shell';
import CalendarPage from './pages/Calendar';
import BookingsPage from './pages/Bookings';
import ServicesPage from './pages/Services';
import CustomersPage from './pages/Customers';
import AvailabilityPage from './pages/Availability';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/calendario" replace />} />
        <Route path="/calendario" element={<CalendarPage />} />
        <Route path="/marcacoes" element={<BookingsPage />} />
        <Route path="/servicos" element={<ServicesPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        <Route path="/disponibilidade" element={<AvailabilityPage />} />
      </Routes>
    </Shell>
  );
}
