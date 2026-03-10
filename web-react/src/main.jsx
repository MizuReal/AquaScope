import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext'
import HomePage from './pages/HomePage'
import DashboardLayout from './layouts/DashboardLayout'
import DashboardPage from './pages/DashboardPage'
import ScansPage from './pages/ScansPage'
import AnalyticsPage from './pages/AnalyticsPage'
import SettingsPage from './pages/SettingsPage'
import CommunityPage from './pages/CommunityPage'
import ProfilePage from './pages/ProfilePage'
import AdminLayout from './layouts/AdminLayout'
import AdminDashboardPage from './pages/AdminDashboardPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminAnalyticsPage from './pages/AdminAnalyticsPage'

import AdminForumPage from './pages/AdminForumPage'
import AdminProfilePage from './pages/AdminProfilePage'
import ContainerScanPage from './pages/ContainerScanPage'
import CompareSamplesPage from './pages/CompareSamplesPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import TermsOfServicePage from './pages/TermsOfServicePage'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
        <Route element={<App />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="scans" element={<ScansPage />} />
            <Route path="container-scan" element={<ContainerScanPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="compare" element={<CompareSamplesPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="community" element={<CommunityPage />} />
          </Route>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="forum" element={<AdminForumPage />} />

            <Route path="profile" element={<AdminProfilePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
