import axios from "axios";

const isDev = typeof import.meta !== "undefined" && import.meta.env?.MODE === "development";

export const axiosInstance = axios.create({
  baseURL: isDev ? "http://localhost:3000/api" : "/api",
  withCredentials: true,
});