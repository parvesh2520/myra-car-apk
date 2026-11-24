import { useAppState } from '../../context/AppStore';
import { WelcomeBanner } from './WelcomeBanner';
import { NavigationCard } from './NavigationCard';
import { MediaCard } from './MediaCard';
import { ClimateCard } from './ClimateCard';
import { VehicleCard } from './VehicleCard';
import { SuggestionsCard } from './SuggestionsCard';

/**
 * Context-aware home. Parked: full dashboard. Driving: navigation first, with
 * large climate and audio shortcuts and nothing that invites browsing.
 */
export function HomePage() {
  const { driveMode } = useAppState();

  if (driveMode === 'driving') {
    return (
      <div className="h-full p-5 grid gap-4 grid-cols-[1.65fr_1fr] grid-rows-[1fr_1fr]">
        <NavigationCard className="row-span-2" large />
        <ClimateCard large />
        <MediaCard large />
      </div>
    );
  }

  return (
    <div className="h-full p-5 grid gap-4 grid-cols-[1.3fr_1fr_0.95fr] grid-rows-[auto_1fr_1fr]">
      <WelcomeBanner className="col-span-3" />
      <NavigationCard className="row-span-2" />
      <MediaCard />
      <SuggestionsCard />
      <ClimateCard />
      <VehicleCard />
    </div>
  );
}
