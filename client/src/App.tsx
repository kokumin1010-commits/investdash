import DashboardLayout from "@/components/DashboardLayout";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { PasscodeProvider } from "./contexts/PasscodeContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import BuyPlans from "./pages/BuyPlans";
import Dividends from "./pages/Dividends";
import HoldingDetail from "./pages/HoldingDetail";
import Holdings from "./pages/Holdings";
import ImportScreenshot from "./pages/ImportScreenshot";
import News from "./pages/News";
import Reports from "./pages/Reports";
import Consult from "./pages/Consult";
import SettingsPage from "./pages/Settings";
import Watchlist from "./pages/Watchlist";

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/holdings" component={Holdings} />
      <Route path="/holdings/:id" component={HoldingDetail} />
      <Route path="/dividends" component={Dividends} />
      <Route path="/buy-plans" component={BuyPlans} />
      <Route path="/reports" component={Reports} />
      <Route path="/consult" component={Consult} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/news" component={News} />
      <Route path="/import" component={ImportScreenshot} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const basePath =
    import.meta.env.BASE_URL === "/"
      ? undefined
      : import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider delayDuration={200}>
          <Toaster position="top-center" />
          <PasscodeProvider>
            <SidebarProvider>
              <DashboardLayout>
                <WouterRouter base={basePath}>
                  <AppRoutes />
                </WouterRouter>
              </DashboardLayout>
            </SidebarProvider>
          </PasscodeProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
