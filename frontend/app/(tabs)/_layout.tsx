import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/src/theme";

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.mutedText,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: theme.font.text },
        tabBarIcon: ({ color, size }) => {
          const map: Record<string, any> = {
            home: "home",
            cart: "shopping-bag",
            orders: "package",
            profile: "user",
          };
          return <Feather name={map[route.name] || "circle"} size={20} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Shop" }} />
      <Tabs.Screen name="cart" options={{ title: "Cart" }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
