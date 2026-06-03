import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider } from './lib/toast.jsx';
import Layout from './components/Layout.jsx';
import GlobalLoader from './components/GlobalLoader.jsx';

import Login          from './pages/Login.jsx';
import Reset          from './pages/Reset.jsx';
import InitialSetup   from './pages/InitialSetup.jsx';
import Users          from './pages/Users.jsx';
import Contacts       from './pages/Contacts.jsx';
import Vendors        from './pages/Vendors.jsx';
import VendorDetail   from './pages/VendorDetail.jsx';
import Locations      from './pages/Locations.jsx';
import Skus           from './pages/Skus.jsx';
import SkuDetail      from './pages/SkuDetail.jsx';
import VendorSkus     from './pages/VendorSkus.jsx';
import Dashboard     from './pages/Dashboard.jsx';
import UserTypes      from './pages/UserTypes.jsx';
import VendorTypes    from './pages/VendorTypes.jsx';
import SkuTypes       from './pages/SkuTypes.jsx';
import ChangeLog      from './pages/ChangeLog.jsx';
import Backups        from './pages/Backups.jsx';
import LoadStock      from './pages/LoadStock.jsx';
import Stock          from './pages/Stock.jsx';
import Audit              from './pages/Audit.jsx';

import './styles.css';

function HomeRedirect() {
  const { user } = useAuth();
  // ASO users have no Dashboard access — land them on their Audit screen.
  if (user?.user_type_code === 'ASO') return <Navigate to="/audit" replace />;
  return <Navigate to="/dashboard" replace />;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <GlobalLoader force />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.initial_setup_required) return <Navigate to="/setup" replace />;
  return children;
}

function SetupGate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <GlobalLoader force />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.initial_setup_required) return <HomeRedirect />;
  return children;
}

/**
 * Show a page only if the current user is allowed to *use* it.
 * Unknown roles fall through to home. The backend enforces this too.
 */
function RoleGate({ allow, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.user_type_code)) return <HomeRedirect />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/setup" element={<SetupGate><InitialSetup /></SetupGate>} />

          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<HomeRedirect />} />
            <Route path="dashboard" element={<RoleGate allow={['SA', 'ADMIN']}><Dashboard /></RoleGate>} />

            {/* SA scope */}
            <Route path="user-types" element={<RoleGate allow={['SA', 'ADMIN']}><UserTypes /></RoleGate>} />
            <Route path="backups"    element={<RoleGate allow={['SA']}><Backups /></RoleGate>} />

            {/* ADMIN scope */}
            <Route path="users"               element={<RoleGate allow={['SA', 'ADMIN']}><Users /></RoleGate>} />
            <Route path="contacts"            element={<RoleGate allow={['ADMIN']}><Contacts /></RoleGate>} />
            <Route path="vendors"             element={<RoleGate allow={['SA', 'ADMIN']}><Vendors /></RoleGate>} />
            <Route path="vendors/:id"         element={<RoleGate allow={['SA', 'ADMIN']}><VendorDetail /></RoleGate>} />
            <Route path="locations"           element={<RoleGate allow={['SA', 'ADMIN']}><Locations /></RoleGate>} />
            <Route path="skus"                element={<RoleGate allow={['SA', 'ADMIN']}><Skus /></RoleGate>} />
            <Route path="skus/:id"            element={<RoleGate allow={['SA', 'ADMIN']}><SkuDetail /></RoleGate>} />
            <Route path="vendor-skus"         element={<RoleGate allow={['ADMIN']}><VendorSkus /></RoleGate>} />
            <Route path="vendor-types"        element={<RoleGate allow={['ADMIN']}><VendorTypes /></RoleGate>} />
            <Route path="sku-types"           element={<RoleGate allow={['ADMIN']}><SkuTypes /></RoleGate>} />
            <Route path="change-log"          element={<RoleGate allow={['ADMIN']}><ChangeLog /></RoleGate>} />

            {/* Phase 2 — Load Stock (ADMIN only) */}
            <Route path="load-stock"          element={<RoleGate allow={['ADMIN']}><LoadStock /></RoleGate>} />
            <Route path="stock"               element={<RoleGate allow={['ADMIN']}><Stock /></RoleGate>} />

            {/* Phase 3 (ASO slice) — ASO audit screen. ASO-location assignment
                lives on the Locations Modify form (Assign ASO Users panel). */}
            <Route path="audit"               element={<RoleGate allow={['ASO']}><Audit /></RoleGate>} />
          </Route>

          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
