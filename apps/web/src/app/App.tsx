import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"

import { ErrorBoundary } from "../components/ErrorBoundary"
import { SiteHeader } from "../components/SiteHeader"
import { SkipLink } from "../components/SkipLink"
import { HomePage } from "../pages/HomePage"
import { MethodologyPage } from "../pages/MethodologyPage"
import { NotFoundPage } from "../pages/NotFoundPage"
import { WorkDetailPage } from "../pages/WorkDetailPage"
import { WorksPage } from "../pages/WorksPage"
import { AuthProvider } from "../features/auth/AuthProvider"
import { ProtectedRoute } from "../features/auth/ProtectedRoute"
import { GuideDock } from "../features/guide/GuideDock"
import { GuideProvider } from "../features/guide/GuideProvider"
import { ChangePasswordPage } from "../pages/ChangePasswordPage"
import { LoginPage } from "../pages/LoginPage"
import { ContributionPage } from "../pages/ContributionPage"
import { MySubmissionsPage, SubmissionDetailPage } from "../pages/MySubmissionsPage"
import { AdminReviewsPage } from "../pages/AdminReviewsPage"
import { AdminUsersPage } from "../pages/AdminUsersPage"
import { AdminAuditPage } from "../pages/AdminAuditPage"
import { useAuth } from "../features/auth/AuthProvider"

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } })

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/works" element={<WorksPage />} />
      <Route path="/works/:workId" element={<WorkDetailPage />} />
      <Route path="/methodology" element={<MethodologyPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route element={<ProtectedRoute role="contributor" />}>
        <Route path="/contribute" element={<AuthenticatedContribution />} />
        <Route path="/my-submissions" element={<MySubmissionsPage />} />
        <Route path="/my-submissions/:submissionId" element={<AuthenticatedSubmissionDetail />} />
      </Route>
      <Route element={<ProtectedRoute role="admin" />}>
        <Route path="/admin/reviews" element={<AdminReviewsPage />} />
        <Route path="/admin/reviews/:submissionId" element={<AdminReviewsPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/audit" element={<AdminAuditPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function AuthenticatedContribution() {
  const { csrfToken } = useAuth()
  return <ContributionPage csrfToken={csrfToken ?? ""} />
}

function AuthenticatedSubmissionDetail() {
  const { csrfToken } = useAuth()
  return <SubmissionDetailPage csrfToken={csrfToken ?? ""} />
}

function HeaderErrorFallback() {
  return (
    <header className="site-header site-header--fallback">
      <p className="site-header__fallback" role="alert">页首暂时无法显示，请使用页面主要内容。</p>
    </header>
  )
}

export function HeaderBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<HeaderErrorFallback />}>{children}</ErrorBoundary>
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <GuideProvider>
      <SkipLink />
      <HeaderBoundary><SiteHeader /></HeaderBoundary>
      <ErrorBoundary>{children}</ErrorBoundary>
      <ErrorBoundary fallback={null}><GuideDock /></ErrorBoundary>
    </GuideProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppFrame><AppRoutes /></AppFrame>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
