import React, { useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Text, Button, Avatar, IconButton , useTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Bem-vindo ao PriceScoutPT',
    icon: 'hand-wave',
    description: 'Pesquisa preços de 5 supermercados portugueses — Continente, Lidl, Pingo Doce, Aldi e Auchan — mesmo sem internet, tudo guardado no teu telemóvel.',
    color: colors.primary,
  },
  {
    title: 'Como Pesquisar',
    icon: 'magnify',
    description: 'Escreve o nome do produto na barra no topo (ex: "arroz" ou "atum"). Usa os filtros de supermercado e de categoria para afinares a pesquisa.',
    color: colors.primary,
  },
  {
    title: 'Como Adicionar ao Cabaz',
    icon: 'cart-plus',
    description: 'Toca no ícone do carrinho de um produto para o adicionares à tua lista de compras. Ajusta as quantidades no separador Meu Cabaz.',
    color: colors.success,
  },
  {
    title: 'Como Comparar',
    icon: 'scale-balance',
    description: 'No separador Comparar vês o custo total do teu cabaz em cada supermercado. O supermercado mais barato ganha o troféu.',
    color: colors.success,
  },
  {
    title: 'Histórico de Preços',
    icon: 'chart-bell-curve-cumulative',
    description: 'Toca num produto para veres a evolução do preço nos últimos 30 dias e evitares falsas promoções.',
    color: colors.danger,
  },
  {
    title: 'Manter Atualizado',
    icon: 'sync',
    description: 'Puxa a lista para baixo ou toca no ícone de sincronização para obteres os preços mais recentes. A recolha é automática todos os dias.',
    color: colors.danger,
  },
];

const OnboardingScreen = ({ onComplete }) => {
  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    try {
      await AsyncStorage.setItem('@onboarding_completed', 'true');
      onComplete();
    } catch (e) {
      console.error("[Onboarding AsyncStorage Error]:", e);
      // Fallback
      onComplete();
    }
  };

  const activeSlide = SLIDES[currentSlide];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.slideContainer}>
        {/* Ícone de Destaque Animado / Estético */}
        <Avatar.Icon 
          icon={activeSlide.icon} 
          size={120} 
          backgroundColor={activeSlide.color} 
          color={colors.surface} 
          style={styles.icon}
        />
        
        {/* Título */}
        <Text variant="headlineMedium" style={[styles.title, { color: activeSlide.color }]} accessibilityRole="header">
          {activeSlide.title}
        </Text>
        
        {/* Descrição */}
        <Text variant="bodyLarge" style={styles.description}>
          {activeSlide.description}
        </Text>
      </View>

      {/* Indicadores de Slide (Dots) */}
      <View
        style={styles.dotsRow}
        accessible
        accessibilityLabel={`Página ${currentSlide + 1} de ${SLIDES.length}: ${activeSlide.title}`}
        importantForAccessibility="yes"
      >
        {SLIDES.map((_, index) => (
          <View 
            key={index} 
            style={[
              styles.dot, 
              { backgroundColor: index === currentSlide ? activeSlide.color : colors.border },
              index === currentSlide ? styles.activeDot : null
            ]} 
            accessible={false}
          />
        ))}
      </View>

      {/* Barra de Ações Inferior */}
      <View style={styles.footerRow}>
        {currentSlide < SLIDES.length - 1 ? (
          <>
            <Button 
              mode="text" 
              textColor={colors.textMuted} 
              onPress={handleComplete}
              style={styles.skipButton}
            >
              Saltar
            </Button>
            <Button 
              mode="contained" 
              buttonColor={activeSlide.color} 
              textColor={colors.surface}
              onPress={handleNext}
              style={styles.actionButton}
            >
              Seguinte
            </Button>
          </>
        ) : (
          <Button 
            mode="contained" 
            buttonColor={activeSlide.color} 
            textColor={colors.surface} 
            onPress={handleComplete}
            style={styles.fullActionButton}
            icon="rocket-launch"
          >
            Começar a Poupar
          </Button>
        )}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingVertical: 24,
  },
  slideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 40,
  },
  icon: {
    marginBottom: 32,
    elevation: 4,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    color: colors.textSecondary,
    lineHeight: 24,
    paddingHorizontal: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  activeDot: {
    width: 20,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    minHeight: 48,
  },
  skipButton: {
    minWidth: 80,
  },
  actionButton: {
    minWidth: 120,
    borderRadius: 24,
  },
  fullActionButton: {
    flex: 1,
    borderRadius: 24,
    marginHorizontal: 8,
  },
});

export default OnboardingScreen;
