import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RelationshipProvider } from "./context/RelationshipContext";
import { PhotoProvider } from "./context/PhotoContext";
import { router } from "./router";
import "./styles/index.scss";

export default function App() {
  return (
    <AuthProvider>
      <RelationshipProvider>
        <PhotoProvider>
          <RouterProvider router={router} />
        </PhotoProvider>
      </RelationshipProvider>
    </AuthProvider>
  );
}
