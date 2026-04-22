import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import FleetInfo from './pages/FleetInfo';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Overview from './pages/Overview';
import VehicleList from './pages/VehicleList';
import Shipments from './pages/Shipments';
import ProtectedRoute from './guards/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Home />}>
            <Route path="/dashboard" element={<Overview />} />
            <Route path="/fleet-info" element={<FleetInfo />} />
            <Route path="/vehicle-list" element={<VehicleList />} />
            <Route path="/shipments" element={<Shipments />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  )
}

export default App
