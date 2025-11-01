import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
} from "firebase/auth";
import { getDatabase, ref, onValue } from "firebase/database";
import {
  Thermometer,
  Droplet,
  Sun,
  Zap,
  AlertTriangle,
  CheckCircle,
  Leaf,
  BarChart3,
  Fan,
  Target,
  Waves,
} from "lucide-react";

// --- Global variables provided by the environment (required for Firebase) ---
const firebaseConfig = {
  apiKey: "AIzaSyCCYiljdtPktFUmUht59_d8K7v7WeiPWdg",
  authDomain: "control-greenhouse.firebaseapp.com",
  databaseURL:
    "https://control-greenhouse-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "control-greenhouse",
  storageBucket: "control-greenhouse.firebasestorage.app",
  messagingSenderId: "709830402011",
  appId: "1:709830402011:web:62734c8fc399968df951fe",
  measurementId: "G-86LDGV6SWT",
};

const initialAuthToken =
  typeof __initial_auth_token !== "undefined" ? __initial_auth_token : null;

// --- FASTAPI ML ENDPOINT ---
const API_URL = "http://localhost:8000/predict";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

// --- MOCK HISTORY CONFIG ---
const HISTORY_MAX_POINTS = 30; // ~ 2.5 minutes of data (5s interval * 30 points)

// Animation variants - only for initial load
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

const getHealthStyles = (code) => {
  switch (code) {
    case 2:
      return {
        bg: "bg-green-100 border-green-400 text-green-800",
        icon: CheckCircle,
      };
    case 1:
      return {
        bg: "bg-yellow-100 border-yellow-400 text-yellow-800",
        icon: AlertTriangle,
      };
    case 0:
      return {
        bg: "bg-red-100 border-red-400 text-red-800",
        icon: AlertTriangle,
      };
    default:
      return { bg: "bg-gray-100 border-gray-400 text-gray-800", icon: Leaf };
  }
};

// --- MOCK LINE CHART COMPONENT ---
const HistoryChart = ({ history }) => {
  const labels = history.map((_, i) => `${i * 5}s`);
  const tempValues = history.map((d) => d.temperature);
  const soilValues = history.map((d) => d.soil_pct);

  // Simple SVG Line Chart implementation
  const width = 600;
  const height = 150;
  const padding = 20;

  const maxTemp = 35;
  const maxSoil = 100;

  const getPoints = (data, max) => {
    const scaleY = (val) =>
      height - padding - (val / max) * (height - 2 * padding);
    const scaleX = (i) =>
      padding + (i / (data.length - 1)) * (width - 2 * padding);

    return data.map((val, i) => `${scaleX(i)},${scaleY(val)}`).join(" ");
  };

  // Only draw if there are at least two data points
  const canDraw = history.length > 1;

  const tempPoints = canDraw ? getPoints(tempValues, maxTemp) : "";
  const soilPoints = canDraw ? getPoints(soilValues, maxSoil) : "";

  return (
    <div className="bg-white p-6 rounded-2xl shadow-2xl mt-8">
      <h2 className="text-2xl font-bold mb-4 border-b pb-2">
        Critical Sensor Trends (Last {HISTORY_MAX_POINTS * 5}s)
      </h2>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          {/* Y-axis labels (Mock) */}
          <text
            x={padding - 15}
            y={height - padding}
            fontSize="10"
            fill="#6B7280"
          >
            0
          </text>
          <text x={padding - 15} y={height / 2} fontSize="10" fill="#6B7280">
            T/H/S
          </text>

          {/* Zero Line (Baseline) */}
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="#D1D5DB"
            strokeWidth="1"
          />

          {/* Temperature Line */}
          {canDraw && (
            <polyline
              fill="none"
              stroke="#EF4444"
              strokeWidth="2"
              points={tempPoints}
            />
          )}
          {/* Soil Moisture Line */}
          {canDraw && (
            <polyline
              fill="none"
              stroke="#FBBF24"
              strokeWidth="2"
              points={soilPoints}
            />
          )}
        </svg>
      </div>
      <div className="flex justify-around text-xs pt-2 font-mono">
        {labels
          .filter((_, i) => i % 5 === 0)
          .map((label, i) => (
            <span key={i} className="text-gray-500">
              {label}
            </span>
          ))}
      </div>

      <div className="flex justify-center gap-4 mt-4 text-sm font-semibold">
        <span className="flex items-center text-red-500">
          <span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span>{" "}
          Temperature (Max {maxTemp}°C)
        </span>
        <span className="flex items-center text-yellow-500">
          <span className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></span> Soil
          Moisture (Max {maxSoil}%)
        </span>
      </div>
    </div>
  );
};

// --- CORE APP COMPONENT ---
const App = () => {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sensorData, setSensorData] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [isLoadingPrediction, setIsLoadingPrediction] = useState(false);
  // NEW STATE: Historical data buffer
  const [history, setHistory] = useState([]);

  const hasAnimated = useRef(false);

  // Firebase Authentication
  useEffect(() => {
    const authenticate = async () => {
      try {
        if (initialAuthToken)
          await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);

        setIsAuthReady(true);
      } catch (error) {
        console.error("Firebase Auth Error:", error);
      }
    };
    authenticate();
  }, []);

  useEffect(() => {
    if (isAuthReady) {
      const timer = setTimeout(() => (hasAnimated.current = true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isAuthReady]);

  // Firebase Listeners
  useEffect(() => {
    if (!isAuthReady) return;

    const deviceRef = ref(db, "iot/device");
    const unsubscribeDevice = onValue(deviceRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setSensorData(data);

        // NEW LOGIC: Update historical data buffer
        setHistory((prevHistory) => {
          const newHistory = [
            ...prevHistory,
            {
              temperature: data.temperature || 0,
              humidity: data.humidity || 0,
              soil_pct: data.soil_pct || 0,
            },
          ];
          // Keep only the last HISTORY_MAX_POINTS
          if (newHistory.length > HISTORY_MAX_POINTS) {
            newHistory.shift();
          }
          return newHistory;
        });
      }
    });

    return () => {
      unsubscribeDevice();
    };
  }, [isAuthReady]);

  // Fetch ML predictions every 5 sec
  const fetchPrediction = useCallback(async () => {
    setIsLoadingPrediction(true);
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      setPrediction(data);
    } catch (error) {
      console.error("ML error:", error);
    }
    setIsLoadingPrediction(false);
  }, []); // Added useCallback

  useEffect(() => {
    if (isAuthReady) fetchPrediction();
    const intervalId = setInterval(fetchPrediction, 5000);
    return () => clearInterval(intervalId);
  }, [isAuthReady, fetchPrediction]); // Added fetchPrediction to dependencies

  const SensorCard = ({ title, value, unit, icon: Icon, colorClass }) => (
    <motion.div
      variants={!hasAnimated.current ? itemVariants : {}}
      whileHover={{ scale: 1.05, y: -5 }}
      className={`p-4 rounded-xl shadow-lg ${colorClass} flex flex-col items-center border`}
    >
      <Icon className="w-6 h-6 mb-2" />
      <h3 className="text-sm font-semibold uppercase">{title}</h3>
      <p className="text-3xl font-extrabold">
        {value}
        <span className="text-base font-normal ml-1">{unit}</span>
      </p>
    </motion.div>
  );

  const SensorSection = () => {
    const currentData = sensorData || {
      temperature: 0,
      humidity: 0,
      soil_pct: 0,
      light_raw: 0,
      gas_raw: 0,
      pid_output: 0,
      fan_pid_output: 0,
    };

    return (
      <motion.div
        variants={!hasAnimated.current ? containerVariants : {}}
        className="grid grid-cols-2 md:grid-cols-7 gap-4"
      >
        <SensorCard
          title="Temperature"
          value={currentData.temperature?.toFixed(1) || 0}
          unit="°C"
          icon={Thermometer}
          colorClass="bg-red-50 border-red-200"
        />
        <SensorCard
          title="Humidity"
          value={currentData.humidity?.toFixed(1) || 0}
          unit="%"
          icon={Droplet}
          colorClass="bg-blue-50 border-blue-200"
        />
        <SensorCard
          title="Soil Moisture"
          value={currentData.soil_pct?.toFixed(1) || 0}
          unit="%"
          icon={Droplet}
          colorClass="bg-yellow-50 border-yellow-200"
        />
        <SensorCard
          title="Light"
          value={currentData.light_raw || 0}
          unit="Raw"
          icon={Sun}
          colorClass="bg-yellow-100 border-yellow-300"
        />
        <SensorCard
          title="Gas"
          value={currentData.gas_raw || 0}
          unit="Raw"
          icon={Zap}
          colorClass="bg-purple-50 border-purple-200"
        />
        <SensorCard
          title="Water PID"
          value={currentData.pid_output?.toFixed(1) || 0}
          unit="%"
          icon={BarChart3}
          colorClass="bg-green-100 border-green-200"
        />
        <SensorCard
          title="Fan Speed"
          value={currentData.fan_pid_output?.toFixed(1) || 0}
          unit="%"
          icon={Fan}
          colorClass="bg-cyan-100 border-cyan-200"
        />
      </motion.div>
    );
  };

  // --- PID Control Summary Section ---
  const ControlSummary = () => {
    // These values are hardcoded based on the ESP32 code provided earlier
    const moistureSetpoint = 60.0;
    const fanTargetTemp = 28.0;
    const currentData = sensorData || {};

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <div className="p-4 bg-gray-100 rounded-xl shadow-inner flex items-center">
          <Target className="w-6 h-6 mr-3 text-green-600" />
          <div>
            <p className="text-sm text-gray-600 font-medium">
              Moisture Setpoint
            </p>
            <p className="text-xl font-bold text-gray-800">
              {moistureSetpoint.toFixed(1)}%
            </p>
          </div>
        </div>
        <div className="p-4 bg-gray-100 rounded-xl shadow-inner flex items-center">
          <Thermometer className="w-6 h-6 mr-3 text-red-600" />
          <div>
            <p className="text-sm text-gray-600 font-medium">Fan Target Temp</p>
            <p className="text-xl font-bold text-gray-800">
              {fanTargetTemp.toFixed(1)}°C
            </p>
          </div>
        </div>
        <div className="p-4 bg-gray-100 rounded-xl shadow-inner flex items-center">
          <Waves
            className={`w-6 h-6 mr-3 ${
              currentData.pid_trigger ? "text-blue-500" : "text-gray-400"
            }`}
          />
          <div>
            <p className="text-sm text-gray-600 font-medium">
              Water PID Trigger
            </p>
            <p
              className={`text-xl font-bold ${
                currentData.pid_trigger ? "text-blue-600" : "text-gray-500"
              }`}
            >
              {currentData.pid_trigger ? "ACTIVE" : "STANDBY"}
            </p>
          </div>
        </div>
        <div className="p-4 bg-gray-100 rounded-xl shadow-inner flex items-center">
          <Fan
            className={`w-6 h-6 mr-3 ${
              currentData.fan_trigger ? "text-cyan-500" : "text-gray-400"
            }`}
          />
          <div>
            <p className="text-sm text-gray-600 font-medium">Fan Trigger</p>
            <p
              className={`text-xl font-bold ${
                currentData.fan_trigger ? "text-cyan-600" : "text-gray-500"
              }`}
            >
              {currentData.fan_trigger ? "ACTIVE" : "STANDBY"}
            </p>
          </div>
        </div>
      </div>
    );
  };
  // --- END PID Control Summary Section ---

  const FanStatus = () => {
    const fanOutput = sensorData?.fan_pid_output || 0;
    const fanTrigger = sensorData?.fan_trigger || false;

    // Calculate rotation speed based on PID output (0-100%)
    const rotationDuration =
      fanOutput > 0 ? Math.max(0.5, 3 - (fanOutput / 100) * 2.5) : 0;

    return (
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-cyan-500 to-blue-600 mt-6 text-white p-6 rounded-2xl shadow-xl mb-6"
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-2xl font-bold mb-2">Fan Control System</h3>
            <p className="text-lg mb-1">
              Status:{" "}
              <span className="font-semibold">
                {fanTrigger ? "ACTIVE" : "STANDBY"}
              </span>
            </p>
            <p className="text-lg">
              Speed:{" "}
              <span className="font-bold text-3xl">
                {fanOutput.toFixed(1)}%
              </span>
            </p>
          </div>

          <div className="flex flex-col items-center">
            <motion.div
              animate={fanOutput > 0 ? { rotate: 360 } : { rotate: 0 }}
              transition={{
                duration: rotationDuration,
                repeat: fanOutput > 0 ? Infinity : 0,
                ease: "linear",
              }}
              className="relative"
            >
              <Fan className="w-32 h-32" strokeWidth={1.5} />
            </motion.div>
            <p className="text-sm mt-2 opacity-90">
              {fanOutput === 0
                ? "Off"
                : fanOutput < 30
                ? "Low"
                : fanOutput < 70
                ? "Medium"
                : "High"}
            </p>
          </div>

          <div className="flex-1 flex justify-end">
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
              <p className="text-sm opacity-90 mb-1">Rotation Speed</p>
              <div className="relative w-24 h-24 mx-auto">
                <svg className="transform -rotate-90 w-24 h-24">
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="opacity-30"
                  />
                  <motion.circle
                    cx="48"
                    cy="48"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    animate={{
                      strokeDashoffset:
                        2 * Math.PI * 40 * (1 - fanOutput / 100),
                    }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                    className="text-white"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold">
                    {Math.round(fanOutput)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // --- Pump Status Section (Simplified Logic) ---
  const PumpStatus = () => {
    // Logc requested: if soil_pct is lesser than 60 then it is on else it is off
    const soilMoisture = sensorData?.soil_pct || 100; // Default to 100 (OFF) if no data
    const moistureSetpoint = 60; // Directly use the controller's setpoint

    // The pump is considered ON if the current moisture is below the setpoint
    const isOn = soilMoisture < moistureSetpoint;

    return (
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className={`${
          isOn ? "bg-green-600" : "bg-gray-400"
        } text-white p-6 rounded-2xl shadow-xl mb-6 text-center`}
        transition={{ duration: 0.3 }}
      >
        <p className="text-3xl font-bold mb-2">
          {isOn ? "💧 Pump ACTIVE - Soil Low" : "💧 Pump Off - Soil OK"}
        </p>
        <p className="text-lg">
          Current Soil Moisture:{" "}
          <span className="font-mono text-2xl font-bold">
            {soilMoisture.toFixed(1)}%
          </span>
        </p>
        <p className="text-sm mt-2 opacity-80">
          Trigger Threshold: Below {moistureSetpoint}%
        </p>
      </motion.div>
    );
  };
  // --- END Pump Status Section ---

  const BarGraphSection = () => {
    const currentData = sensorData || {
      temperature: 0,
      humidity: 0,
      soil_pct: 0,
      light_raw: 0,
      gas_raw: 0,
      pid_output: 0,
      fan_pid_output: 0,
    };

    const chartData = [
      {
        name: "Temp",
        fullName: "Temperature",
        value: parseFloat(currentData.temperature?.toFixed(1) || 0),
        unit: "°C",
        color: "bg-red-500",
        max: 50,
        icon: Thermometer,
      },
      {
        name: "Humid",
        fullName: "Humidity",
        value: parseFloat(currentData.humidity?.toFixed(1) || 0),
        unit: "%",
        color: "bg-blue-500",
        max: 100,
        icon: Droplet,
      },
      {
        name: "Soil",
        fullName: "Soil Moisture",
        value: parseFloat(currentData.soil_pct?.toFixed(1) || 0),
        unit: "%",
        color: "bg-yellow-500",
        max: 100,
        icon: Droplet,
      },
      {
        name: "Water",
        fullName: "Water PID",
        value: parseFloat(currentData.pid_output?.toFixed(1) || 0),
        unit: "%",
        color: "bg-green-600",
        max: 100,
        icon: BarChart3,
      },
      {
        name: "Fan",
        fullName: "Fan Speed",
        value: parseFloat(currentData.fan_pid_output?.toFixed(1) || 0),
        unit: "%",
        color: "bg-cyan-600",
        max: 100,
        icon: Fan,
      },
      {
        name: "Gas",
        fullName: "Gas Sensor",
        value: currentData.gas_raw || 0,
        unit: "Raw",
        color: "bg-purple-500",
        max: 1024,
        icon: Zap,
      },
    ];

    return (
      <div className="bg-white p-6 rounded-2xl shadow-2xl mt-8">
        <div className="flex items-center mb-6 border-b pb-4">
          <BarChart3 className="w-6 h-6 mr-2 text-green-600" />
          <h2 className="text-2xl font-bold text-gray-700">
            Real-time Sensor Value Comparison
          </h2>
        </div>

        <div className="flex justify-around items-end h-80 gap-4">
          {chartData.map((item, index) => {
            const percentage = (item.value / item.max) * 100;
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className="flex flex-col items-center flex-1"
              >
                <div className="relative w-full h-64 bg-gray-200 rounded-t-xl flex flex-col justify-end overflow-hidden">
                  <motion.div
                    animate={{ height: `${percentage}%` }}
                    transition={{
                      duration: 0.5,
                      ease: "easeInOut",
                    }}
                    className={`w-full ${item.color} rounded-t-xl relative`}
                  >
                    <div className="absolute top-2 left-0 right-0 text-center">
                      <span className="text-white font-bold text-sm">
                        {item.value}
                      </span>
                      <span className="text-white text-xs ml-1">
                        {item.unit}
                      </span>
                    </div>
                  </motion.div>
                </div>
                <div className="mt-3 text-center">
                  <Icon className="w-5 h-5 mx-auto mb-1 text-gray-600" />
                  <p className="text-sm font-semibold text-gray-700">
                    {item.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {percentage.toFixed(0)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const PredictionSection = () => {
    const p = prediction || {};
    const { bg, icon: HealthIcon } = getHealthStyles(p.code);

    return (
      <div className="bg-white p-6 rounded-2xl shadow-2xl mt-8">
        <h2 className="text-2xl font-bold mb-4 border-b pb-2">
          ML Plant Health Prediction
        </h2>

        <div className={`p-4 rounded-xl border-2 ${bg}`}>
          <h3 className="text-xl font-bold flex items-center">
            <HealthIcon className="w-6 h-6 mr-2" />{" "}
            {p.health_status || "Waiting..."}
          </h3>
          <p className="whitespace-pre-wrap">{p.recommendation}</p>
          {isLoadingPrediction && <p className="text-xs mt-2">Fetching...</p>}
        </div>
      </div>
    );
  };

  if (!isAuthReady) {
    return (
      <div className="flex justify-center items-center h-screen">
        Initializing Firebase...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-sans">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-extrabold text-green-700 flex justify-center items-center">
          <Leaf className="w-8 h-8 mr-3" /> Smart Greenhouse Monitoring System
        </h1>
        <p className="text-gray-500 mt-2">
          Real-time data + ML prediction + PID water control
        </p>
      </header>

      <div className="max-w-6xl mx-auto">
        <SensorSection />
        <ControlSummary />
        <FanStatus />
        <PumpStatus />
        <HistoryChart history={history} />
        <BarGraphSection />
        <PredictionSection />
      </div>
    </div>
  );
};

export default App;
