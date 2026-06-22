import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/lib/AuthContext";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface }}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/auth" />;
  return <Redirect href="/(tabs)/home" />;
}
